import { controlsGrid } from './controlsList';
import { el } from './dom';

export interface PauseMenuActions {
  resume(): void;
  toggleHeadBob(): boolean;
  cycleQuality(): string;
  togglePostFX(): boolean;
  toggleView(): string;
  toggleGrass(): boolean;
  toggleClouds(): boolean;
}

/** Pause menu: shows the full controls list plus a few settings. */
export class PauseMenu {
  readonly root: HTMLElement;
  private bobBtn: HTMLButtonElement;
  private qualityBtn: HTMLButtonElement;
  private fxBtn: HTMLButtonElement;
  private viewBtn: HTMLButtonElement;
  private grassBtn: HTMLButtonElement;
  private cloudBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, actions: PauseMenuActions, state: { headBob: boolean; quality: string; postFX: boolean; view: string }) {
    this.root = el('div', 'overlay hidden');
    const panel = el('div', 'panel interactive', '', this.root);
    el('h2', '', 'Paused', panel);
    el('div', 'sub', 'Press <kbd>P</kbd> to resume. Physics, particles and powers are frozen.', panel);
    panel.appendChild(controlsGrid());
    const row = el('div', 'btn-row', '', panel);
    const resume = el('button', 'btn primary', 'Resume', row);
    resume.onclick = () => actions.resume();
    this.bobBtn = el('button', 'btn', '', row);
    this.bobBtn.onclick = () => this.setBob(actions.toggleHeadBob());
    this.qualityBtn = el('button', 'btn', '', row);
    this.qualityBtn.onclick = () => this.setQuality(actions.cycleQuality());
    this.fxBtn = el('button', 'btn', '', row);
    this.fxBtn.onclick = () => this.setFX(actions.togglePostFX());
    this.viewBtn = el('button', 'btn', '', row);
    this.viewBtn.onclick = () => this.setView(actions.toggleView());
    this.grassBtn = el('button', 'btn', '', row);
    this.grassBtn.onclick = () => this.setGrass(actions.toggleGrass());
    this.cloudBtn = el('button', 'btn', '', row);
    this.cloudBtn.onclick = () => this.setClouds(actions.toggleClouds());
    this.setBob(state.headBob);
    this.setQuality(state.quality);
    this.setFX(state.postFX);
    this.setView(state.view);
    parent.appendChild(this.root);
  }

  setBob(on: boolean) {
    this.bobBtn.textContent = `Head bob: ${on ? 'On' : 'Off'}`;
  }
  setQuality(q: string) {
    this.qualityBtn.textContent = `Quality: ${q}`;
  }
  setFX(on: boolean) {
    this.fxBtn.textContent = `Post FX: ${on ? 'On' : 'Off'}`;
  }
  setGrass(on: boolean) {
    this.grassBtn.textContent = `Grass: ${on ? 'On' : 'Off'}`;
  }
  setClouds(on: boolean) {
    this.cloudBtn.textContent = `Clouds: ${on ? 'On' : 'Off'}`;
  }

  setView(v: string) {
    this.viewBtn.textContent = `View: ${v}`;
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }
}
