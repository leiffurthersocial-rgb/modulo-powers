/**
 * Procedural WebAudio sound engine. No audio files: every effect is synthesised
 * from oscillators and filtered noise.
 *
 * - `unlock()` must be called from a user gesture (the start overlay).
 * - One-shot effects are fire-and-forget node graphs that are garbage
 *   collected once they stop.
 * - Loops (flamethrower roar, flowing water, rain) return a handle with
 *   `setLevel` / `stop` so the caller can fade them.
 * - Positional sounds are attenuated and panned against the listener (camera)
 *   with a cheap custom model instead of PannerNode (lower CPU cost on iPad).
 */
export interface LoopHandle {
  setLevel(v: number, ramp?: number): void;
  setRate(v: number): void;
  setPosition(x: number, y: number, z: number): void;
  stop(fade?: number): void;
}

type Vec3 = { x: number; y: number; z: number };

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;
  muted = false;
  /** Listener position and right vector for panning. */
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private rx = 1;
  private rz = 0;
  /** Global playback-rate multiplier (slow-motion pitches sounds down). */
  rate = 1;
  /** When paused all audio is ducked. */
  private duck = 1;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.sfx = ctx.createGain();
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.6;
    this.sfx.connect(this.compressor);
    this.ambient.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(ctx.destination);

    // Pre-render white and brown noise buffers (2 s each).
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyMaster();
  }

  setPaused(p: boolean) {
    this.duck = p ? 0.15 : 1;
    this.applyMaster();
  }

  private applyMaster() {
    if (!this.ctx) return;
    const v = this.muted ? 0 : 0.8 * this.duck;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(pos: Vec3, right: Vec3) {
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    const l = Math.hypot(right.x, right.z) || 1;
    this.rx = right.x / l;
    this.rz = right.z / l;
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Distance attenuation + stereo pan for a world position.
   * `ref` is the distance at which the sound is at full volume.
   */
  spatial(pos: Vec3 | undefined, ref = 6): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.lx;
    const dy = pos.y - this.ly;
    const dz = pos.z - this.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = ref / Math.max(ref, dist);
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, (dx * this.rx + dz * this.rz) / dist)) * 0.8 : 0;
    return { gain, pan };
  }

  /** Creates gain→panner→sfx chain for a positional sound. Returns the input node. */
  private out(pos?: Vec3, ref = 6, volume = 1, bus: 'sfx' | 'ambient' = 'sfx'): GainNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const { gain, pan } = this.spatial(pos, ref);
    const v = gain * volume;
    if (v < 0.004) return null;
    const g = ctx.createGain();
    g.gain.value = v;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(bus === 'sfx' ? this.sfx : this.ambient);
    } else {
      g.connect(bus === 'sfx' ? this.sfx : this.ambient);
    }
    return g;
  }

  private noiseSource(brown = false): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brownBuf : this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    src.playbackRate.value = this.rate;
    return src;
  }

  /**
   * Filtered noise burst with an attack/decay envelope — the workhorse for
   * impacts, footsteps, whooshes, crackles and explosions.
   */
  noiseBurst(opts: {
    pos?: Vec3;
    volume?: number;
    ref?: number;
    attack?: number;
    decay: number;
    filter?: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    brown?: boolean;
    delay?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = this.out(opts.pos, opts.ref ?? 6, opts.volume ?? 1);
    if (!out) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0) / this.rate;
    const attack = (opts.attack ?? 0.005) / this.rate;
    const decay = opts.decay / this.rate;
    const src = this.noiseSource(opts.brown);
    const f = ctx.createBiquadFilter();
    f.type = opts.filter ?? 'lowpass';
    f.Q.value = opts.q ?? 0.8;
    f.frequency.setValueAtTime(opts.freq * this.rate, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd * this.rate), t0 + attack + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(1, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    src.connect(f).connect(env).connect(out);
    src.start(t0);
    src.stop(t0 + attack + decay + 0.05);
  }

  /** Simple pitched tone with envelope and optional glide. */
  tone(opts: {
    pos?: Vec3;
    volume?: number;
    ref?: number;
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    attack?: number;
    decay: number;
    delay?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = this.out(opts.pos, opts.ref ?? 6, opts.volume ?? 1);
    if (!out) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0) / this.rate;
    const attack = (opts.attack ?? 0.01) / this.rate;
    const decay = opts.decay / this.rate;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq * this.rate, t0);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(10, opts.freqEnd * this.rate), t0 + attack + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(1, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  /** A continuous filtered-noise loop (fire roar, water flow, rain, wind). */
  loop(opts: {
    pos?: Vec3;
    ref?: number;
    volume?: number;
    filter?: BiquadFilterType;
    freq: number;
    q?: number;
    brown?: boolean;
    bus?: 'sfx' | 'ambient';
    /** Amplitude LFO for flicker (Hz, depth 0..1). */
    lfo?: { rate: number; depth: number };
  }): LoopHandle {
    const ctx = this.ctx;
    const dummy: LoopHandle = { setLevel() {}, setRate() {}, setPosition() {}, stop() {} };
    if (!ctx) return dummy;
    const bus = opts.bus === 'ambient' ? this.ambient : this.sfx;
    const src = this.noiseSource(opts.brown);
    const f = ctx.createBiquadFilter();
    f.type = opts.filter ?? 'lowpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 0.7;
    const level = ctx.createGain();
    level.gain.value = 0;
    const spatialGain = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(f).connect(level).connect(spatialGain);
    if (pan) spatialGain.connect(pan).connect(bus);
    else spatialGain.connect(bus);
    let lfoOsc: OscillatorNode | null = null;
    if (opts.lfo) {
      lfoOsc = ctx.createOscillator();
      lfoOsc.frequency.value = opts.lfo.rate;
      const depth = ctx.createGain();
      depth.gain.value = opts.lfo.depth;
      lfoOsc.connect(depth).connect(level.gain);
      lfoOsc.start();
    }
    src.start();
    const volume = opts.volume ?? 1;
    const ref = opts.ref ?? 8;
    let pos: Vec3 | undefined = opts.pos ? { ...opts.pos } : undefined;
    let stopped = false;
    const applySpatial = () => {
      const s = this.spatial(pos, ref);
      spatialGain.gain.setTargetAtTime(s.gain, ctx.currentTime, 0.05);
      if (pan) pan.pan.setTargetAtTime(s.pan, ctx.currentTime, 0.05);
    };
    applySpatial();
    return {
      setLevel: (v: number, ramp = 0.08) => {
        if (stopped) return;
        level.gain.setTargetAtTime(v * volume, ctx.currentTime, ramp);
      },
      setRate: (r: number) => {
        if (stopped) return;
        src.playbackRate.setTargetAtTime(r * this.rate, ctx.currentTime, 0.05);
      },
      setPosition: (x: number, y: number, z: number) => {
        if (stopped) return;
        pos = { x, y, z };
        applySpatial();
      },
      stop: (fade = 0.2) => {
        if (stopped) return;
        stopped = true;
        level.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        src.stop(ctx.currentTime + fade + 0.1);
        lfoOsc?.stop(ctx.currentTime + fade + 0.1);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Shared sound recipes.
  // ---------------------------------------------------------------------------

  footstep(pos: Vec3, surface: 'grass' | 'stone' | 'wood' | 'metal' | 'water' | 'sand', heavy = 1) {
    const v = 0.22 * heavy;
    switch (surface) {
      case 'stone':
        this.noiseBurst({ pos, volume: v, decay: 0.07, filter: 'bandpass', freq: 1800, q: 1.2 });
        break;
      case 'wood':
        this.noiseBurst({ pos, volume: v, decay: 0.09, filter: 'bandpass', freq: 700, q: 2 });
        this.tone({ pos, volume: v * 0.4, freq: 180, freqEnd: 120, decay: 0.08, type: 'triangle' });
        break;
      case 'metal':
        this.noiseBurst({ pos, volume: v * 0.7, decay: 0.05, filter: 'highpass', freq: 3000 });
        this.tone({ pos, volume: v * 0.3, freq: 620, decay: 0.25, type: 'triangle' });
        break;
      case 'water':
        this.noiseBurst({ pos, volume: v * 1.3, decay: 0.18, filter: 'bandpass', freq: 900, freqEnd: 400, q: 0.9 });
        break;
      case 'sand':
        this.noiseBurst({ pos, volume: v, decay: 0.12, filter: 'highpass', freq: 2500 });
        break;
      default:
        this.noiseBurst({ pos, volume: v, decay: 0.1, filter: 'bandpass', freq: 1200, freqEnd: 600, q: 0.7 });
    }
  }

  land(pos: Vec3, strength: number) {
    this.noiseBurst({ pos, volume: 0.25 + strength * 0.4, decay: 0.16, freq: 600, freqEnd: 120, brown: true });
  }

  jump(pos: Vec3) {
    this.noiseBurst({ pos, volume: 0.12, decay: 0.12, filter: 'bandpass', freq: 900, freqEnd: 1600 });
  }

  /** Physics impact: louder and lower for heavier / faster hits. */
  impact(pos: Vec3, energy: number, material: 'wood' | 'stone' | 'metal' | 'ice' | 'generic') {
    const v = Math.min(1, energy);
    if (v < 0.03) return;
    switch (material) {
      case 'metal':
        this.tone({ pos, volume: v * 0.5, freq: 380 + Math.random() * 400, decay: 0.5, type: 'triangle', ref: 8 });
        this.noiseBurst({ pos, volume: v * 0.4, decay: 0.05, filter: 'highpass', freq: 2500, ref: 8 });
        break;
      case 'stone':
        this.noiseBurst({ pos, volume: v * 0.8, decay: 0.18, freq: 900, freqEnd: 200, brown: true, ref: 10 });
        break;
      case 'ice':
        this.tone({ pos, volume: v * 0.3, freq: 2400, freqEnd: 1800, decay: 0.15, type: 'sine' });
        this.noiseBurst({ pos, volume: v * 0.5, decay: 0.12, filter: 'highpass', freq: 4000 });
        break;
      case 'wood':
        this.noiseBurst({ pos, volume: v * 0.7, decay: 0.12, filter: 'bandpass', freq: 500, q: 1.5, ref: 8 });
        this.tone({ pos, volume: v * 0.3, freq: 140, freqEnd: 90, decay: 0.12, type: 'triangle' });
        break;
      default:
        this.noiseBurst({ pos, volume: v * 0.6, decay: 0.1, freq: 800, freqEnd: 200 });
    }
  }

  uiClick(high = false) {
    this.tone({ volume: 0.12, freq: high ? 1100 : 760, decay: 0.06, type: 'triangle' });
  }

  uiDeny() {
    this.tone({ volume: 0.12, freq: 220, freqEnd: 160, decay: 0.15, type: 'square' });
  }
}

export const audio = new AudioEngine();
