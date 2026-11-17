// Geometry of the island: coast, ground height, zones and roads. Pure math with no rendering,
// shared by the page (which places the entries at build time) and the game (which draws them).
//
// Bearings are compass angles in radians: 0 is north (-z), a quarter turn is east (+x).
//
// The island is a ring of lowland around a mountain. The timeline road runs around it through
// four zones, each closed off from the next by an obstacle that one machine overcomes:
//   start   → plateau  a steep ramp (the e-bike or the car climbs it)
//   plateau → valley   a river (the car jumps it at speed, once the tourists clear the run-up)
//   valley  → yard     a guard who shoots at anyone coming close (identified through a camera)
//   yard    → harbour  a gorge blocked by litter (the litter robot clears it)
//   harbour → islet    the sea (the boat crosses it)
// The mountain in the middle, with the cape of the lighthouse, is reached by flying.

export const TAU = Math.PI * 2;
export const ROAD_HALF = 2.6;
/** Radius of the area the visitor can move in. */
export const WORLD_R = 372;

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
/** Bearing in degrees, 0 to 360. */
const degOf = (x: number, z: number) => ((bearingOf(x, z) * 180) / Math.PI + 360) % 360;

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
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
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

// ---------- Zones ----------

export type Zone = 'start' | 'plateau' | 'valley' | 'yard' | 'harbour' | 'islet' | 'mountain' | 'sea';
/** The zones in the order the visitor goes through them. */
export const ZONE_ORDER: Zone[] = ['start', 'plateau', 'valley', 'yard', 'harbour', 'islet', 'mountain'];

/** Borders between the zones of the ring, as bearings in degrees, clockwise. */
export const BORDER = { massifEnd: 201, ramp: 265, river: 318, guard: 352, gorge: 20, massifStart: 71 };
/** The mountain: flat top up to PLATEAU_R, cliffs down to FOOT_R. */
export const PLATEAU_R = 64;
export const FOOT_R = 78;
export const MOUNT_H = 24;
/** Height of the plateau zone above the lowland. */
const PLATEAU_RISE = 6;

/** The islet, east of the island across a channel. */
export const ISLET = polar(rad(105), 287);
export const ISLET_BEARING = rad(105);
const isletRadius = (a: number) => 60 + 3 * Math.sin(3 * a) + 2 * Math.sin(5 * a + 1);
/** A point of the islet's shoreline at angle `a` around its centre, pushed `extra` out to sea. */
export const isletShore = (a: number, extra = 0): Pt => ({ x: ISLET.x + (isletRadius(a) + extra) * Math.sin(a), z: ISLET.z - (isletRadius(a) + extra) * Math.cos(a) });
/** A point of the islet: `u` across, `v` away from the island, from its centre. */
export const isletPoint = (u: number, v: number): Pt => ({
  x: ISLET.x + Math.cos(ISLET_BEARING) * u + Math.sin(ISLET_BEARING) * v,
  z: ISLET.z + Math.sin(ISLET_BEARING) * u - Math.cos(ISLET_BEARING) * v,
});
/** The landing on the islet, facing the island. */
export const ISLET_DOCK = isletPoint(0, -54);
/** Distance inside the islet's shore (negative at sea). */
export function isletInland(x: number, z: number): number {
  return isletRadius(Math.atan2(x - ISLET.x, -(z - ISLET.z))) - Math.hypot(x - ISLET.x, z - ISLET.z);
}

/** Smooth 0 to 1 inside an arc of bearings (degrees, may wrap), with soft edges `edge` degrees wide. */
function inArc(deg: number, from: number, to: number, edge: number): number {
  const span = (to - from + 360) % 360;
  const d = (deg - from + 360) % 360;
  if (d > span + edge && d < 360 - edge) return 0;
  const into = d > span + edge ? d - 360 : d;
  return smoothstep(-edge, edge, into) * smoothstep(span + edge, span - edge, into);
}

// ---------- Coast and ground ----------

/** Distance of the island's shoreline from the centre along a bearing. The bump to the south carries the lighthouse. */
export function coastRadius(b: number): number {
  const south = angDiff(b, Math.PI);
  return 192 + 7 * Math.sin(3 * b + 1) + 5 * Math.sin(5 * b + 2.3) + 3.5 * Math.sin(8 * b + 0.6) + 20 * Math.exp(-(south * south) / 0.03);
}

/** Radius of the ring road along a bearing. */
export const ringRadius = (b: number) => 135 + 2.5 * Math.sin(3 * b + 0.5);

/** Ground height before the building sites are levelled. The sea surface is at 0. */
export function baseHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const b = bearingOf(x, z);
  const deg = degOf(x, z);
  const inland = coastRadius(b) - r;

  // The islet.
  const isl = isletInland(x, z);
  const islet = isl <= 0 ? Math.max(-7, isl * 0.22) : 0.35 + 2.2 * smoothstep(0, 16, isl) + fbm(x * 0.03, z * 0.03) * 2.5 * smoothstep(8, 30, isl);

  if (inland <= 0) return Math.max(islet, Math.max(-7, inland * 0.22));

  let h = 0.35 + 2.6 * smoothstep(0, 30, inland) + fbm(x * 0.016, z * 0.016) * 4 * smoothstep(16, 56, inland);

  // The plateau zone, a step up from the start zone.
  h += PLATEAU_RISE * inArc(deg, BORDER.ramp, BORDER.river, 2) * smoothstep(0, 10, inland);

  // The mountain: a flat top in the middle and a massif that runs out to the south-east coast.
  const top = MOUNT_H * smoothstep(FOOT_R, PLATEAU_R, r);
  const massif = (MOUNT_H - 4) * inArc(deg, BORDER.massifStart + 2, BORDER.massifEnd - 2, 2) * smoothstep(0, 14, inland);
  const mountain = Math.max(top, massif);
  if (mountain > 0.5) h += mountain + (fbm(x * 0.05, z * 0.05) - 0.5) * 5 * smoothstep(2, 12, mountain) * smoothstep(MOUNT_H, MOUNT_H - 6, mountain);

  // The ridge between valley and harbour, open only at the gorge where the road passes.
  const ridge = Math.abs(r * angDiff(b, rad(BORDER.gorge)));
  const gorge = smoothstep(9, 13, Math.abs(r - ringRadius(b)));
  h += 11 * smoothstep(8, 3, ridge) * gorge * smoothstep(FOOT_R - 6, FOOT_R + 4, r);

  // The river between plateau and valley, from the foot of the mountain to the sea.
  const river = Math.abs(r * angDiff(b, rad(BORDER.river)));
  const bed = smoothstep(FOOT_R - 6, FOOT_R - 1, r);
  if (river < 10 && bed > 0) h = lerp(h, Math.min(h, -2.2), smoothstep(10, 5.5, river) * bed);

  return h;
}

/** Which zone a point is in. */
export function zoneOf(x: number, z: number): Zone {
  if (baseHeight(x, z) <= 0.3) return 'sea';
  if (isletInland(x, z) > -2) return 'islet';
  if (Math.hypot(x, z) < FOOT_R) return 'mountain';
  const deg = degOf(x, z);
  if (deg >= BORDER.massifStart && deg < BORDER.massifEnd) return 'mountain';
  if (deg >= BORDER.massifEnd && deg < BORDER.ramp) return 'start';
  if (deg >= BORDER.ramp && deg < BORDER.river) return 'plateau';
  if (deg >= BORDER.river && deg < BORDER.guard) return 'valley';
  if (deg >= BORDER.guard || deg < BORDER.gorge) return 'yard';
  return 'harbour';
}

// ---------- Roads ----------

const RING_FROM = rad(206);
const RING_SWEEP = rad(220);

/** The timeline road: around the mountain, clockwise from the start to the harbour. */
function buildMain() {
  const pts: Pt[] = [];
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const b = RING_FROM + (RING_SWEEP * i) / steps;
    pts.push(polar(b, ringRadius(b)));
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, length: cum[cum.length - 1] };
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

/** Distance along the road to where it reaches a bearing (degrees). */
export function roadAt(deg: number): number {
  const along = (((rad(deg) - RING_FROM) % TAU) + TAU) % TAU;
  const f = clamp(along / RING_SWEEP, 0, 1) * (mainRoad.pts.length - 1);
  const i = Math.floor(f);
  const { cum } = mainRoad;
  return i >= cum.length - 1 ? cum[cum.length - 1] : lerp(cum[i], cum[i + 1], f - i);
}

/** Where the road crosses each obstacle. */
export const RAMP = mainAt(roadAt(BORDER.ramp));
export const RIVER_CROSSING = mainAt(roadAt(BORDER.river));
export const GORGE = mainAt(roadAt(BORDER.gorge));
/** The guard on the road between valley and yard, and the security camera that can see him. */
export const GUARD = mainAt(roadAt(BORDER.guard));
export const CAMERA_POST = polar(rad(342), ringRadius(rad(342)) + 17);
/** Where the tourists crowd the road on the plateau, before the run-up to the river (degrees). */
export const CROWD_DEG = 300;
export const CROWD = mainAt(roadAt(CROWD_DEG));

/**
 * Places off the road, at the end of a side path that leaves it just before an obstacle: the
 * visitor meets the obstacle first, then finds what overcomes it. `branch` is where the path
 * leaves the road (degrees), `at` where the place stands, `via` an optional point the path bends
 * toward on its way.
 */
export const SIDE: Record<'tent' | 'superres', { branch: number; at: Pt; via?: Pt }> = {
  /**
   * The 2023 hackathon (crowd flow at big events): out toward the coast, back from the tourists
   * and well apart from them, so the crowd on the road is seen on its own.
   */
  tent: { branch: 287, at: polar(rad(292), 160) },
  /** Super-resolution, before the checkpoint in the valley. */
  superres: { branch: 336, at: polar(rad(345), 100) },
};

/** A side path: a gentle curve from the road to 15 units short of the place. */
function sidePath(branch: number, at: Pt, via?: Pt): Pt[] {
  const a = mainAt(roadAt(branch));
  const from = via ?? a;
  const d = Math.hypot(at.x - from.x, at.z - from.z);
  const end = { x: at.x + ((from.x - at.x) / d) * 15, z: at.z + ((from.z - at.z) / d) * 15 };
  // The bend: toward `via`, or halfway, pulled a little along the road.
  const ahead = mainAt(roadAt(branch) + 10);
  const mid = via ?? { x: (a.x + end.x) / 2 + (ahead.x - a.x) * 0.2, z: (a.z + end.z) / 2 + (ahead.z - a.z) * 0.2 };
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push({ x: lerp(lerp(a.x, mid.x, t), lerp(mid.x, end.x, t), t), z: lerp(lerp(a.z, mid.z, t), lerp(mid.z, end.z, t), t) });
  }
  return pts;
}
export const sidePaths = Object.values(SIDE).map(({ branch, at, via }) => sidePath(branch, at, via));

/**
 * The secret: a crate of explosives hidden among rocks on the top of the mountain. Nothing on the
 * map or in the hints points to it.
 */
export const CAVE = polar(rad(135), 52);

/**
 * A wall of boulders across the plateau just past the tourists, from the foot of the mountain to
 * the sea, open only where the road runs: the crowd fills that gap until it makes way.
 */
export const BOULDERS: Pt[] = (() => {
  const deg = CROWD_DEG + 1.5;
  const b = rad(deg);
  const road = ringRadius(b);
  const out: Pt[] = [];
  for (let r = FOOT_R - 4; r < coastRadius(b) + 4; r += 4.2) {
    if (Math.abs(r - road) < 8) continue;
    out.push(polar(b + Math.sin(r * 1.7) * 0.012, r));
  }
  return out;
})();

/** Where the lighthouse stands, on the cape to the south. */
export const LIGHTHOUSE_R = coastRadius(Math.PI) - 11;

const ROADS = [mainRoad.pts, ...sidePaths];

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
