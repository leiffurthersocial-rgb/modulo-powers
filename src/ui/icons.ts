/** SVG path data for HUD icons, all on a 24×24 viewBox. */
export const ICONS = {
  // Powers
  lightning: 'M13.5 2 5 13.5h6L9.5 22 19 10h-6.2z',
  fire: 'M12 2c1 3.2 4.8 5.3 4.8 10.2A4.9 4.9 0 0 1 12 17.3a4.9 4.9 0 0 1-4.8-5c0-2.2 1.2-3.6 2.3-4.6.2 1.9 1 2.9 2 3.3C11.2 8 10.7 5 12 2zM12 22c-4.3 0-7.5-3-7.5-7.2 0-1.5.4-2.9 1.2-4.1.5 3.4 3 6.6 6.3 6.6s5.8-3.2 6.3-6.6c.8 1.2 1.2 2.6 1.2 4.1C19.5 19 16.3 22 12 22z',
  water: 'M12 2.5S5 10.2 5 14.8a7 7 0 0 0 14 0C19 10.2 12 2.5 12 2.5zm-3.2 12.6a.9.9 0 0 1 1.8 0 1.6 1.6 0 0 0 1.6 1.6.9.9 0 0 1 0 1.8 3.4 3.4 0 0 1-3.4-3.4z',
  earth: 'M2 20 8.5 8l3.5 6 2.5-4L22 20zM8.5 12.2 6 17h5.2z',
  shadow: 'M14.5 2.5A9.5 9.5 0 1 0 21.5 17 7.8 7.8 0 0 1 14.5 2.5z',
  // Generic ability glyphs
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  chain: 'M4 12l4-6 3 4 4-6 3 5 2-2M4 18l4-4 3 3 4-5 3 3 2-1',
  dash: 'M3 12h9M5 8h7M5 16h7M14 6l7 6-7 6z',
  storm: 'M6 14a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 17 7a3.5 3.5 0 0 1 1 7zM11 15l-2 4h3l-1 3 4-5h-3l1-2z',
  fireball: 'M15 9a6 6 0 1 1-6 6c0-4 2-5 6-6zM15 9c1-3 3-5 7-7-2 3-2 5-3 7M12 8c0-2 1-4 3-6',
  flamethrower: 'M2 11h6v2H2zM8 9l14-5v16L8 15z',
  wall: 'M3 20V9l3 2 2-6 3 5 2-6 3 6 2-4 3 5v9z',
  thrust: 'M12 2l4 7h-3v6h-2V9H8zM8 17c1 2 2 3 4 5 2-2 3-3 4-5-1 1-2 1-4 1s-3 0-4-1z',
  jet: 'M3 13h12M3 9h9M3 17h9M15 7c4 0 6 2 6 5s-2 5-6 5z',
  wave: 'M2 15c3 0 3-3 6-3s3 3 6 3 3-6 8-8c-1 3-1 5 0 7-3 0-3 3-6 3s-3-3-6-3-3 3-8 3z',
  snowflake: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2',
  bubble: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 8a5 5 0 0 1 4-2',
  pillar: 'M8 22V8l4-4 4 4v14zM4 22h16',
  boulder: 'M5 15c-1-4 2-8 6-9 5-1 8 2 8 6 1 4-2 7-7 7-4 0-6-1-7-4z',
  quake: 'M2 18h4l2-5 3 7 3-12 3 9 2-3h3',
  armor: 'M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  blink: 'M4 18c2-1 3-3 3-5M20 6l-6 6M14 6h6v6M4 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  phase: 'M4 4h6v16H4zM14 4h6v16h-6zM2 12h20',
  clone: 'M8 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 21v-5a5 5 0 0 1 10 0v5zM16 5a3 3 0 1 1 0 6M14 21v-5a5 5 0 0 1 7-4.5',
};

export function svgIcon(path: string, color = 'currentColor', size = 24): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="${path}" fill="${color}" fill-opacity="0.25"/></svg>`;
}
