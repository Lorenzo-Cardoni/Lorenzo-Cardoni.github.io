// Geometry of the island: coast, ground height and roads. Pure math with no rendering, shared by
// the page (which places the entries at build time) and the game (which draws them).
//
// Bearings are compass angles in radians: 0 is north (-z), a quarter turn is east (+x).

export const TAU = Math.PI * 2;
export const RING_R = 118;
export const ROAD_HALF = 2.6;
/** Radius of the area the drone can fly in. */
export const WORLD_R = 300;

export interface Pt {
  x: number;
  z: number;
}

export const rad = (deg: number) => (deg * Math.PI) / 180;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Works in both directions: smoothstep(52, 8, r) falls from 1 to 0 as r grows. */
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** a - b, wrapped to [-PI, PI]. */
export function angDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const polar = (b: number, r: number): Pt => ({ x: r * Math.sin(b), z: -r * Math.cos(b) });
export const bearingOf = (x: number, z: number) => Math.atan2(x, -z);

// ---------- Noise ----------

function hash(ix: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Value noise in [0, 1]. */
export function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x: number, z: number) =>
  noise(x, z) * 0.6 + noise(x * 2.1 + 7.3, z * 2.1 - 3.1) * 0.3 + noise(x * 4.3 - 1.7, z * 4.3 + 9.2) * 0.1;

/** Small deterministic random generator, so the island is the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Coast and ground ----------

/** Distance of the shoreline from the centre along a bearing. The bump to the south carries the lighthouse. */
export function coastRadius(b: number): number {
  const south = angDiff(b, Math.PI);
  return (
    192 +
    7 * Math.sin(3 * b + 1) +
    5 * Math.sin(5 * b + 2.3) +
    3.5 * Math.sin(8 * b + 0.6) +
    20 * Math.exp(-(south * south) / 0.03)
  );
}

/** Ground height before the building sites are levelled. The sea surface is at 0. */
export function baseHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const inland = coastRadius(bearingOf(x, z)) - r;
  if (inland <= 0) return Math.max(-7, inland * 0.22);
  const hills = fbm(x * 0.016, z * 0.016) * 6 * smoothstep(16, 56, inland);
  const centre = 5 * smoothstep(72, 10, r);
  return 0.35 + 2.6 * smoothstep(0, 30, inland) + hills + centre;
}

// ---------- Roads ----------

const RING_FROM = rad(228);
const RING_SWEEP = rad(252);
const CURL_SWEEP = rad(55);
const CURL_END_R = 18;

const ringRadius = (b: number) => RING_R + 4 * Math.sin(3 * b + 0.5);

/**
 * The timeline road: three quarters of a ring around the island, walked clockwise from the first
 * dated entry to the latest, then a curl inward that ends at the landing pad in the centre.
 */
function buildMain() {
  const pts: Pt[] = [];
  const ringSteps = 180;
  for (let i = 0; i <= ringSteps; i++) {
    const b = RING_FROM + (RING_SWEEP * i) / ringSteps;
    pts.push(polar(b, ringRadius(b)));
  }
  const ringCount = pts.length;
  const curlSteps = 56;
  for (let j = 1; j <= curlSteps; j++) {
    const f = j / curlSteps;
    const b = RING_FROM + RING_SWEEP + CURL_SWEEP * f;
    pts.push(polar(b, lerp(ringRadius(b), CURL_END_R, smoothstep(0, 1, f))));
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, ringLength: cum[ringCount - 1] };
}

export const mainRoad = buildMain();

/** Point of the timeline road at a distance s from its start. */
export function mainAt(s: number): Pt {
  const { pts, cum } = mainRoad;
  const d = clamp(s, 0, cum[cum.length - 1]);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { x: lerp(pts[i - 1].x, pts[i].x, t), z: lerp(pts[i - 1].z, pts[i].z, t) };
}

/** Where the avenue to the south ends and the lighthouse stands. */
export const LIGHTHOUSE_R = coastRadius(Math.PI) - 11;

/** The avenue: a straight road from the landing pad to the lighthouse. */
export const avenue: Pt[] = (() => {
  const pts: Pt[] = [];
  const end = LIGHTHOUSE_R - 9;
  for (let r = 15; r < end; r += 3) pts.push({ x: 0, z: r });
  pts.push({ x: 0, z: end });
  return pts;
})();

/**
 * The start path: from the landing pad in the centre to the beginning of the timeline road,
 * so the first move is obvious. It bends gently instead of running dead straight.
 */
export const startPath: Pt[] = (() => {
  const end = mainRoad.pts[0];
  const endR = Math.hypot(end.x, end.z);
  const endB = bearingOf(end.x, end.z);
  const pts: Pt[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const r = lerp(19, endR, f);
    const b = endB - 0.22 * Math.sin(Math.PI * f);
    pts.push(polar(b, r));
  }
  return pts;
})();

const ROADS = [mainRoad.pts, avenue, startPath];

/** Distance from a point to the nearest road centre line. */
export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const pts of ROADS) {
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x;
      const az = pts[i - 1].z;
      const dx = pts[i].x - ax;
      const dz = pts[i].z - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}
