// Colors of the 3D world, once for the dark theme and once for the light theme, and the shared
// materials that use them. The accent matches --accent in src/styles/global.css.
import * as THREE from 'three';

export type ThemeName = 'dark' | 'light';

export interface Palette {
  zenith: number;
  horizon: number;
  // Ground
  sand: number;
  low: number;
  high: number;
  seabed: number;
  shore: number;
  contour: number;
  contourA: number;
  grid: number;
  gridA: number;
  road: number;
  roadEdge: number;
  site: number;
  water: number;
  waterLine: number;
  waterLineA: number;
  // Objects
  structure: number;
  dark: number;
  light: number;
  white: number;
  window: number;
  accent: number;
  signal: number;
  tree: number;
  trunk: number;
  rock: number;
  asphalt: number;
  court: number;
  roof: number;
  pool: number;
  // Light
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  /** Light beams add onto a dark sky and are painted over a light one. */
  additive: boolean;
  beamA: number;
  stars: number;
}

export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    zenith: 0x060908,
    horizon: 0x18241f,
    sand: 0x3d4234,
    low: 0x18221d,
    high: 0x2e3c35,
    seabed: 0x070f0e,
    shore: 0x8fa39b,
    contour: 0xc3f25e,
    contourA: 0.14,
    grid: 0xffffff,
    gridA: 0.04,
    road: 0x29332f,
    roadEdge: 0x71827b,
    site: 0x202a26,
    water: 0x0c1c1a,
    waterLine: 0x8fd6c4,
    waterLineA: 0.2,
    structure: 0x4d5b55,
    dark: 0x242d2a,
    light: 0x98a8a1,
    white: 0xe6ede9,
    window: 0xdcefa6,
    accent: 0xc3f25e,
    signal: 0xff8a4c,
    tree: 0x27573e,
    trunk: 0x2b312d,
    rock: 0x4c5450,
    asphalt: 0x1b211f,
    court: 0x8c8160,
    roof: 0x8a4f3f,
    pool: 0x2f9db0,
    hemiSky: 0xcfe0d8,
    hemiGround: 0x29332f,
    hemi: 1.6,
    sun: 1.9,
    additive: true,
    beamA: 0.3,
    stars: 0.7,
  },
  light: {
    zenith: 0xb9d0c5,
    horizon: 0xf5f7f3,
    sand: 0xe9e3cc,
    low: 0xdde6d2,
    high: 0xb6c9ab,
    seabed: 0x93b3ad,
    shore: 0xffffff,
    contour: 0x2c6e12,
    contourA: 0.2,
    grid: 0x000000,
    gridA: 0.05,
    road: 0xfafbf8,
    roadEdge: 0x8d9a8a,
    site: 0xf0f3eb,
    water: 0xa5c5c2,
    waterLine: 0xffffff,
    waterLineA: 0.55,
    structure: 0xc6d0c1,
    dark: 0x66746a,
    light: 0xedf1e9,
    white: 0xffffff,
    window: 0x2f4a3c,
    accent: 0x2c6e12,
    signal: 0xd9541e,
    tree: 0x5d9a62,
    trunk: 0x7a6a55,
    rock: 0xa9b2a7,
    asphalt: 0x8a948b,
    court: 0xe2cf9b,
    roof: 0xc9765c,
    pool: 0x4fb3c8,
    hemiSky: 0xffffff,
    hemiGround: 0xa5b3a3,
    hemi: 2.0,
    sun: 1.5,
    additive: false,
    beamA: 0.4,
    stars: 0,
  },
};

type ColorKey = {
  [K in keyof Palette]: Palette[K] extends number ? K : never;
}[keyof Palette];

/** Shaded by the scene lights. */
const LIT = ['structure', 'dark', 'light', 'white', 'signal', 'tree', 'trunk', 'rock', 'asphalt', 'court', 'roof'] as const;
/** Drawn at full strength whatever the light: lamps, screens and markings. */
const GLOW = ['accent', 'window', 'pool'] as const;

export type MatKey = (typeof LIT)[number] | (typeof GLOW)[number];

const shared = new Map<MatKey, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>();
const tints: { material: THREE.MeshBasicMaterial; key: ColorKey; beam: boolean }[] = [];
const listeners: ((p: Palette) => void)[] = [];
let current: Palette = PALETTES.dark;

export function mat(key: MatKey): THREE.Material {
  let material = shared.get(key);
  if (!material) {
    material = (LIT as readonly string[]).includes(key)
      ? new THREE.MeshLambertMaterial({ color: current[key], flatShading: true })
      : new THREE.MeshBasicMaterial({ color: current[key] });
    shared.set(key, material);
  }
  return material;
}

/**
 * A see-through material of its own in one of the palette colors. `beam` marks light effects,
 * which follow the palette's blending mode.
 */
export function tint(key: ColorKey, opacity: number, beam = false): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: current[key],
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: beam && current.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  tints.push({ material, key, beam });
  return material;
}

export function onPalette(listener: (p: Palette) => void): void {
  listeners.push(listener);
  listener(current);
}

export function applyPalette(name: ThemeName): Palette {
  current = PALETTES[name];
  shared.forEach((material, key) => material.color.set(current[key]));
  for (const { material, key, beam } of tints) {
    material.color.set(current[key]);
    if (beam) {
      material.blending = current.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      material.needsUpdate = true;
    }
  }
  listeners.forEach((listener) => listener(current));
  return current;
}
