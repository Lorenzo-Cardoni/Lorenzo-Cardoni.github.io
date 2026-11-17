// Colors of the 3D world and the shared materials that use them. The island is always seen by day,
// in a warm, earthy palette: cream and terracotta, golden grass, dark pines, a turquoise sea and a
// blue sky. The site's light and dark themes change only the interface around it.
import * as THREE from 'three';
import { addGrain } from './look';

export interface Palette {
  zenith: number;
  horizon: number;
  /** Glow around the sun, low in the sky. */
  sunGlow: number;
  // Ground
  sand: number;
  low: number;
  /** Dry, golden patches in the grass. */
  dry: number;
  high: number;
  seabed: number;
  shore: number;
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
  skin: number;
  /** The Bosch car's dark blue, and the e-bike's bright blue frame. */
  navy: number;
  blue: number;
  /** The Bosch car's orange. */
  orange: number;
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
  sunColor: number;
  sun: number;
  /** Haze: its color is the horizon's; it starts and ends at these distances. */
  fogNear: number;
  fogFar: number;
  /** Light beams are painted over the sky, not added onto it. */
  additive: boolean;
  beamA: number;
  stars: number;
}

export const PALETTE: Palette = {
  zenith: 0x4f8fd8,
  horizon: 0xd9e6e4,
  sunGlow: 0xffe2a8,
  sand: 0xe6cf98,
  low: 0x9fae4e,
  dry: 0xcdb365,
  high: 0x5d7a35,
  seabed: 0x2c7c84,
  shore: 0xffffff,
  road: 0xc79b66,
  roadEdge: 0xa47448,
  site: 0xd9c49b,
  water: 0x3aa6b2,
  waterLine: 0xffffff,
  waterLineA: 0.55,
  structure: 0xd9c7a4,
  dark: 0x5b4434,
  light: 0xf0e2c4,
  white: 0xfff8ec,
  skin: 0xf0c3a0,
  navy: 0x1d2848,
  blue: 0x2457c8,
  orange: 0xf2661c,
  window: 0x4d6a73,
  accent: 0x7fb23a,
  signal: 0xe0602c,
  tree: 0x2f5a33,
  trunk: 0x6e4a30,
  rock: 0xc0643f,
  asphalt: 0x8e6d4c,
  court: 0xd99e62,
  roof: 0xa6452f,
  pool: 0x46b6c6,
  hemiSky: 0xcfe4ff,
  hemiGround: 0x8a6a44,
  hemi: 1.15,
  sunColor: 0xffefd2,
  sun: 2.6,
  fogNear: 160,
  fogFar: 620,
  additive: false,
  beamA: 0.35,
  stars: 0,
};

type ColorKey = {
  [K in keyof Palette]: Palette[K] extends number ? K : never;
}[keyof Palette];

/** Shaded by the scene lights. */
const LIT = ['structure', 'dark', 'light', 'white', 'skin', 'navy', 'blue', 'orange', 'signal', 'tree', 'trunk', 'rock', 'asphalt', 'court', 'roof'] as const;
/** Drawn at full strength whatever the light: lamps, glass and markings. */
const GLOW = ['accent', 'window', 'pool'] as const;

export type MatKey = (typeof LIT)[number] | (typeof GLOW)[number];

const shared = new Map<MatKey, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>();
const current: Palette = PALETTE;

/** How strong the grain is on each lit color: walls and rock the most, skin and leaves hardly. */
const GRAIN: Partial<Record<MatKey, number>> = { structure: 0.13, light: 0.1, white: 0.08, rock: 0.18, trunk: 0.14, asphalt: 0.14, court: 0.1, roof: 0.12, dark: 0.1, tree: 0.08 };

/**
 * Shared material of a palette color. Lit ones are smooth shaded, so the look is soft rather than
 * faceted, and most carry a light grain.
 */
export function mat(key: MatKey): THREE.Material {
  let material = shared.get(key);
  if (!material) {
    if ((LIT as readonly string[]).includes(key)) {
      const lit = new THREE.MeshLambertMaterial({ color: current[key] });
      material = GRAIN[key] ? addGrain(lit, 0.35, GRAIN[key]) : lit;
    } else material = new THREE.MeshBasicMaterial({ color: current[key] });
    shared.set(key, material);
  }
  return material;
}

/** A see-through material of its own in one of the palette colors. `beam` marks light effects. */
export function tint(key: ColorKey, opacity: number, _beam = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: current[key],
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Calls back with the palette. There is only one, so this happens once, right away. */
export function onPalette(listener: (p: Palette) => void): void {
  listener(current);
}
