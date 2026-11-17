import videosData from '../data/videos.json';

export interface VideoFact {
  value: string;
  text: string;
}

export type VideoMedia =
  | { type: 'image'; image: string; alt: string; fit?: 'cover' | 'contain' }
  | { type: 'clip'; clip: string; poster: string; alt: string }
  | { type: 'signals'; items: { label: string; fault: 'freeze' | 'bias' | 'drift' }[]; legend: [string, string] }
  | { type: 'scales'; items: { from: string; to: string; a: number; b: number }[]; via: string }
  | { type: 'schedule'; window: number; unit: string; rows: { label: string; every: number }[] };

export interface VideoSpec {
  problem: { statement: string; detail: string };
  approach: { heading: string; nodes: { title: string; text: string; key?: boolean }[] };
  poc: { heading: string; media: VideoMedia; facts: VideoFact[] };
  results: {
    heading: string;
    bars: { label: string; value: number; display: string }[];
    max: number;
    tiles: VideoFact[];
  };
  outro: { label: string; items: string[] };
}

export const videos = videosData as unknown as Record<string, VideoSpec>;

/** Frame size the videos are designed at; the renderer scales it up for the final file. */
export const STAGE = { width: 1280, height: 720 };

/** Every video uses the same six scenes with the same lengths, in seconds. */
export const SCENES = [
  { id: 'title', seconds: 4 },
  { id: 'problem', seconds: 7 },
  { id: 'approach', seconds: 9 },
  { id: 'poc', seconds: 9 },
  { id: 'results', seconds: 8 },
  { id: 'outro', seconds: 6 },
] as const;

export type SceneId = (typeof SCENES)[number]['id'];

/** Seconds the last frame stays on screen; scripts/render-videos.mjs uses the same value. */
export const END_HOLD = 1.5;

/** Start time and length of each scene, plus the total running time. */
export function sceneTiming() {
  let at = 0;
  const scenes = {} as Record<SceneId, { at: number; seconds: number }>;
  for (const scene of SCENES) {
    scenes[scene.id] = { at, seconds: scene.seconds };
    at += scene.seconds;
  }
  return { scenes, total: at };
}

/**
 * Schematic sensor trace for the fault-injection scene: the true signal over the whole width,
 * and the reading the sensor reports once the fault starts.
 */
export function faultTraces(fault: 'freeze' | 'bias' | 'drift', width: number, height: number, faultAt = 0.42) {
  const steps = 120;
  const mid = height / 2;
  const amp = height * 0.26;
  const wave = (u: number) => 0.62 * Math.sin(2 * Math.PI * 2.1 * u + 0.4) + 0.38 * Math.sin(2 * Math.PI * 5.3 * u + 1.3);

  const point = (u: number, value: number) => `${(u * width).toFixed(1)},${(mid - value * amp).toFixed(1)}`;

  const truth: string[] = [];
  const reading: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    truth.push(point(u, wave(u)));
    if (u < faultAt) continue;
    const since = (u - faultAt) / (1 - faultAt);
    const value = fault === 'freeze' ? wave(faultAt) : fault === 'bias' ? wave(u) + 0.75 : wave(u) + 1.25 * since;
    reading.push(point(u, value));
  }

  return {
    truth: `M${truth.join(' L')}`,
    reading: `M${reading.join(' L')}`,
    faultX: faultAt * width,
  };
}
