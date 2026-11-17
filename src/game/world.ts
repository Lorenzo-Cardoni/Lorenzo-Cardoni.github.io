// Builds the scene: sky, sea, the island's ground and roads, the places, the year gates and the scenery.
import * as THREE from 'three';
import {
  BOULDERS,
  BORDER,
  CAMERA_POST,
  CAVE,
  CROWD_DEG,
  GORGE,
  GUARD,
  ISLET,
  ISLET_BEARING,
  ISLET_DOCK,
  ROAD_HALF,
  TAU,
  WORLD_R,
  baseHeight,
  bearingOf,
  coastRadius,
  isletShore,
  lerp,
  mainAt,
  noise,
  mainRoad,
  polar,
  sidePaths,
  rad,
  rng,
  roadAt,
  roadDistance,
  smoothstep,
  type Pt,
} from './layout';
import { PALETTE, onPalette, tint, type Palette } from './palette';
import { addGrain, addWater, shaderTime } from './look';
import { part } from './kit';
import { buildStation, makeBeacon, makeBarrier, makeDashboard, makeDataCube, makeFlytrap, makePanel, makeSensor, makeStash, makeCameraPost, makeGate, makeJump, makeLitter, makeHitter, makePasserby, makePier, makePoliceCar, makeRampMarks, makeScenery, makeShooter, makeTourist, type Built, type SceneryPlan } from './models';
import type { Gate, StationDef } from './stations';

export interface Site {
  def: StationDef;
  /** Ground level of the site. */
  y: number;
  built: Built;
  group: THREE.Group;
  /** World-space bounds of the model, for the detection box. */
  bounds: THREE.Box3;
  beacon: THREE.Group;
  /** Height of the model in world units. */
  h: number;
  /** Solid parts in world space: x, z, radius, top. */
  solid: [number, number, number, number][];
  /** Roofs in world space (see Built.roofs). */
  roofs: Roof[];
}

export interface Roof {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hw: number;
  hd: number;
  ceiling: number;
  top: number;
}

/** Whether a point lies under (or over) a roof, in plan. */
export function underRoof(roof: Roof, x: number, z: number): boolean {
  const dx = x - roof.x;
  const dz = z - roof.z;
  const lx = dx * roof.cos - dz * roof.sin;
  const lz = dx * roof.sin + dz * roof.cos;
  return Math.abs(lx) < roof.hw && Math.abs(lz) < roof.hd;
}

/** A pile of litter in the gorge: solid until the litter robot clears it. */
export interface Litter {
  x: number;
  z: number;
  r: number;
  object: THREE.Object3D;
}

/** The tourists on the plateau road: each walks from where it stands to the roadside once it may. */
export interface Tourist {
  object: THREE.Object3D;
  from: Pt;
  to: Pt;
}

/**
 * The checkpoint between valley and yard: an armed man among passers-by, a barrier across the road
 * and the police car that comes once he is identified. The game moves them all.
 */
export interface Checkpoint {
  shooter: { group: THREE.Group; gun: THREE.Object3D; halo: THREE.Object3D; flash: THREE.Object3D };
  people: THREE.Object3D[];
  barrier: { group: THREE.Group; arm: THREE.Object3D };
  police: { group: THREE.Group; lights: THREE.Object3D[] };
  /** Distance along the road of the checkpoint. */
  s: number;
}

/** The volleyball court on the mountain, and the player in the middle of it. */
export interface Court {
  hitter: { group: THREE.Group; halo: THREE.Object3D; ball: THREE.Object3D };
  /** The carnivorous plant that swallows the player once he is identified; hidden until then. */
  plant: THREE.Group;
  x: number;
  z: number;
}

/** Where the sun is: warm and fairly low, so shadows are long and soft. */
export const SUN_DIR = new THREE.Vector3(90, 72, 60).normalize();

export interface World {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  sites: Site[];
  litter: Litter[];
  crowd: Tourist[];
  checkpoint: Checkpoint;
  /** The player who keeps hitting the visitor on the volleyball court, if there is a court. */
  court: Court | null;
  /** The security cameras: the head the ghost possesses, and what it watches. */
  cameras: { head: THREE.Object3D; watch: 'checkpoint' | 'court' }[];
  /** Solid boulders out in the open: x, z, radius, top. */
  walls: [number, number, number, number][];
  /** Activities at two workplaces on the mountain (null when the place is missing). */
  tasks: {
    /** Lega del Filo d'Oro: data packets to gather, and the dashboard they feed. */
    lfo: { cubes: THREE.Object3D[]; dashboard: THREE.Object3D } | null;
    /** Inim: sensors to switch on, then the control panel to arm. */
    inim: { sensors: THREE.Object3D[]; panel: THREE.Object3D } | null;
  };
  heightAt: (x: number, z: number) => number;
  update: (t: number) => void;
  /** An explosion: what is near it flies apart. Returns the places ruined and the litter cleared. */
  blast: (x: number, z: number, r: number) => { ruined: Site[]; cleared: number };
}

/** An opaque lit material in a palette color that follows the theme. */
function lit(key: keyof Palette): THREE.MeshLambertMaterial {
  const material = addGrain(new THREE.MeshLambertMaterial(), 0.25, 0.14);
  onPalette((p) => material.color.set(p[key] as number));
  return material;
}

/** A flat strip along a polyline, lying on the ground. */
function ribbon(pts: Pt[], left: number, right: number, heightAt: (x: number, z: number) => number, lift: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    for (const off of [left, right]) {
      const x = p.x + nx * off;
      const z = p.z + nz * off;
      positions.push(x, heightAt(x, z) + lift, z);
    }
    if (i > 0) {
      const o = (i - 1) * 2;
      index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Resamples a polyline at a fixed step, so ribbons follow the ground closely. */
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let j = 1; j <= n; j++) out.push({ x: lerp(a.x, b.x, j / n), z: lerp(a.z, b.z, j / n) });
  }
  return out;
}

/** Year label for a gate, redrawn when the theme changes. */
function label(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, fog: false }));
  sprite.scale.set(6.4, 2.4, 1);
  onPalette((p) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = `#${p.accent.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 8, 256, 80);
    ctx.fillStyle = `#${(p.additive ? 0x0b1205 : 0xffffff).toString(16).padStart(6, '0')}`;
    ctx.font = '600 58px "JetBrains Mono Variable", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
    texture.needsUpdate = true;
  });
  return sprite;
}

export function buildWorld(stations: StationDef[], gates: Gate[]): World {
  const scene = new THREE.Scene();
  const animated: ((t: number) => void)[] = [];

  // ---------- Ground height ----------

  // Every site is levelled; a place inside a building stands on that building's floor.
  const groundOf = new Map(stations.map((s) => [s.id, s.sea ? 0 : Math.max(0.8, baseHeight(s.x, s.z))]));
  for (const s of stations) if (s.inside) groundOf.set(s.id, groundOf.get(s.inside) ?? groundOf.get(s.id)!);
  const levelled = stations.filter((s) => !s.sea && !s.inside).map((s) => ({ x: s.x, z: s.z, r: s.r, y: groundOf.get(s.id)! }));

  const craters: { x: number; z: number; r: number; depth: number }[] = [];
  const heightAt = (x: number, z: number): number => {
    let h = baseHeight(x, z);
    for (const s of levelled) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r + 9) h = lerp(h, s.y, smoothstep(s.r + 9, s.r + 1, d));
    }
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r) h = Math.max(h - c.depth * smoothstep(c.r, c.r * 0.3, d), Math.min(h, 0.6));
    }
    return h;
  };

  // ---------- Sky ----------

  const skyUniforms = {
    zenith: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    glow: { value: new THREE.Color() },
    sunDir: { value: SUN_DIR },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float t = smoothstep(-0.05, 0.6, vDir.y);
          vec3 color = mix(horizon, zenith, t);
          float toSun = max(dot(normalize(vDir), sunDir), 0.0);
          color = mix(color, glow, pow(toSun, 8.0) * 0.55);
          color += glow * pow(toSun, 600.0) * 1.5;
          gl_FragColor = vec4(color, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  scene.fog = new THREE.Fog(0, 160, 620);

  // ---------- Light ----------

  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 360 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.5;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  // ---------- Ground ----------

  const SIZE = 780;
  const SEG = 290;
  const ground = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position as THREE.BufferAttribute;
  const heights = new Float32Array(gp.count);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    const z = gp.getZ(i);
    let h = heightAt(x, z);
    // The ground dips a little under the roads, so their strips never sink into it.
    if (h > 0 && Math.hypot(x, z) < 225) h -= 0.4 * smoothstep(ROAD_HALF + 2.5, ROAD_HALF + 0.5, roadDistance(x, z));
    gp.setY(i, h);
    heights[i] = h;
  }
  ground.computeVertexNormals();
  const groundColors = new Float32Array(gp.count * 3);
  ground.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));
  const groundMaterial = addGrain(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.12, 0.16);
  const groundMesh = new THREE.Mesh(ground, groundMaterial);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const c = new THREE.Color();
  const c2 = new THREE.Color();
  onPalette((p) => {
    for (let i = 0; i < gp.count; i++) {
      const h = heights[i];
      if (h < 0.15) c.set(p.seabed).lerp(c2.set(p.sand), smoothstep(-6, 0.15, h));
      else if (h < 1.4) c.set(p.sand).lerp(c2.set(p.low), smoothstep(0.6, 1.4, h));
      else if (h < 14) {
        // Grass, golden where it is dry, darker in the woods up the slopes.
        const x = gp.getX(i);
        const z = gp.getZ(i);
        c.set(p.low).lerp(c2.set(p.dry), smoothstep(0.45, 0.75, noise(x * 0.035 + 11, z * 0.035 - 4)));
        c.lerp(c2.set(p.high), smoothstep(4, 12, h) * 0.7);
      } else c.set(p.high).lerp(c2.set(p.rock), smoothstep(13, 19, h));
      c.toArray(groundColors, i * 3);
    }
    ground.attributes.color.needsUpdate = true;
  });

  // ---------- Sea ----------

  const water = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), addWater(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.88 })));
  onPalette((p) => (water.material as THREE.MeshLambertMaterial).color.set(p.water));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.receiveShadow = true;
  scene.add(water);

  const coastLoop = (extra: number, y: number, islet = false) => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 240; i++) {
      const b = (i / 240) * TAU;
      const p = islet ? isletShore(b, extra) : polar(b, coastRadius(b) + extra);
      points.push(new THREE.Vector3(p.x, y, p.z));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  };
  const shoreMaterial = new THREE.LineBasicMaterial({ transparent: true });
  onPalette((p) => {
    shoreMaterial.color.set(p.shore);
    shoreMaterial.opacity = 0.7;
  });
  scene.add(new THREE.LineLoop(coastLoop(-0.6, 0.08), shoreMaterial), new THREE.LineLoop(coastLoop(-0.6, 0.08, true), shoreMaterial));

  const swells = [4, 11, 20, 32].flatMap((extra) =>
    [false, true].map((islet) => {
      const material = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
      const loop = new THREE.LineLoop(coastLoop(extra, 0.05, islet), material);
      // The swell grows from the centre of its own shore.
      if (islet) {
        loop.geometry.translate(-ISLET.x, 0, -ISLET.z);
        loop.position.set(ISLET.x, 0, ISLET.z);
      }
      scene.add(loop);
      return { loop, material, extra };
    }),
  );
  let waveAlpha = 0.2;
  onPalette((p) => {
    waveAlpha = p.waterLineA;
    swells.forEach(({ material }) => material.color.set(p.waterLine));
  });
  animated.push((t) =>
    swells.forEach(({ loop, material }, i) => {
      const f = (t * 0.05 + Math.floor(i / 2) / 4) % 1;
      loop.scale.setScalar(1 + f * 0.06);
      material.opacity = waveAlpha * Math.sin(f * Math.PI);
    }),
  );

  // ---------- Roads ----------

  const roadMaterial = lit('road');
  const edgeMaterial = lit('roadEdge');
  // The road stops at the river: the bridge is gone.
  const roads: Pt[][] = [[]];
  for (const q of resample(mainRoad.pts, 2)) {
    if (heightAt(q.x, q.z) > 0.6) roads[roads.length - 1].push(q);
    else if (roads[roads.length - 1].length) roads.push([]);
  }
  for (const pts of roads.filter((r) => r.length > 1)) {
    const road = new THREE.Mesh(ribbon(pts, -ROAD_HALF, ROAD_HALF, heightAt, 0.05), roadMaterial);
    road.receiveShadow = true;
    scene.add(road);
    for (const s of [-1, 1]) {
      scene.add(new THREE.Mesh(ribbon(pts, s * (ROAD_HALF - 0.1), s * (ROAD_HALF - 0.35), heightAt, 0.08), edgeMaterial));
    }
    // A dashed accent line, like a time axis.
    const dashMaterial = tint('white', 0.45);
    for (let i = 0; i + 2 < pts.length; i += 3) scene.add(new THREE.Mesh(ribbon([pts[i], pts[i + 1], pts[i + 2]], -0.16, 0.16, heightAt, 0.1), dashMaterial));
  }

  // The side paths: narrower, without the time axis.
  for (const path of sidePaths) {
    const pts = resample(path, 2);
    const half = ROAD_HALF * 0.6;
    const road = new THREE.Mesh(ribbon(pts, -half, half, heightAt, 0.05), roadMaterial);
    road.receiveShadow = true;
    scene.add(road);
    for (const s of [-1, 1]) scene.add(new THREE.Mesh(ribbon(pts, s * (half - 0.1), s * (half - 0.3), heightAt, 0.08), edgeMaterial));
  }

  // ---------- Obstacles ----------

  /** Rotation that turns +z along the road, the way the timeline runs, at distance s. */
  const along = (s: number) => {
    const a = mainAt(s - 1);
    const b = mainAt(s + 1);
    return Math.atan2(b.x - a.x, b.z - a.z);
  };
  const put = (object: THREE.Object3D, s: number, lift = 0) => {
    const p = mainAt(s);
    object.position.set(p.x, heightAt(p.x, p.z) + lift, p.z);
    object.rotation.y = along(s);
    object.traverse((o) => (o.castShadow = true));
    scene.add(object);
  };

  // The ramp up to the plateau.
  put(makeRampMarks(), roadAt(BORDER.ramp) - 9);

  // The river: a jump on the near bank, where the road ends.
  let bank = roadAt(BORDER.river - 8);
  while (heightAt(mainAt(bank + 1).x, mainAt(bank + 1).z) > 1.2) bank += 0.5;
  let far = bank + 2;
  while (heightAt(mainAt(far).x, mainAt(far).z) < 1.2 && far < bank + 40) far += 0.5;
  put(makeJump(far - bank), bank, -0.1);

  // The gorge: piles of litter from one wall to the other.
  const litter: Litter[] = [];
  const gb = bearingOf(GORGE.x, GORGE.z);
  [-8, -4, 0, 4, 8].forEach((off, i) => {
    const at = polar(gb, Math.hypot(GORGE.x, GORGE.z) + off);
    const pile = makeLitter(31 + i);
    pile.position.set(at.x, heightAt(at.x, at.z), at.z);
    pile.rotation.y = i * 1.3;
    pile.scale.setScalar(1.5);
    pile.traverse((o) => (o.castShadow = true));
    scene.add(pile);
    litter.push({ x: at.x, z: at.z, r: 2.6, object: pile });
  });

  // The tourists, crowding the road before the run-up to the river.
  const crowd: Tourist[] = [];
  const cs = roadAt(CROWD_DEG);
  const crowdRandom = rng(77);
  for (let i = 0; i < 18; i++) {
    const across = (crowdRandom() * 2 - 1) * 7;
    const s2 = cs + (crowdRandom() * 2 - 1) * 5;
    const q = mainAt(s2);
    const b = bearingOf(q.x, q.z);
    const r = Math.hypot(q.x, q.z);
    const from = polar(b, r + across);
    const to = polar(b, r + Math.sign(across || 1) * (11 + crowdRandom() * 7));
    const object = makeTourist(i + 3);
    object.position.set(from.x, heightAt(from.x, from.z), from.z);
    object.rotation.y = crowdRandom() * TAU;
    object.traverse((o) => (o.castShadow = true));
    scene.add(object);
    crowd.push({ object, from, to });
  }
  animated.push((t) => crowd.forEach(({ object }, i) => (object.rotation.z = Math.sin(t * 2 + i) * 0.04)));

  // The checkpoint: the armed man among passers-by, and a barrier across the road on the yard side.
  const guardS = roadAt(BORDER.guard);
  const shooter = makeShooter();
  shooter.group.position.set(GUARD.x, heightAt(GUARD.x, GUARD.z), GUARD.z);
  shooter.group.rotation.y = along(guardS) + Math.PI;
  const people = [0, 1, 2, 3, 4].map((i) => {
    const one = makePasserby(i);
    one.rotation.y = i * 1.9;
    return one;
  });
  const barrier = makeBarrier();
  {
    const q = mainAt(guardS + 4);
    const yaw = along(guardS + 4);
    // The post at one side of the road, the arm across it.
    const x = q.x - Math.cos(yaw) * (ROAD_HALF + 1);
    const z = q.z + Math.sin(yaw) * (ROAD_HALF + 1);
    barrier.group.position.set(x, heightAt(x, z), z);
    barrier.group.rotation.y = yaw;
  }
  const police = makePoliceCar();
  police.group.scale.setScalar(1.6);
  police.group.visible = false;
  for (const o of [shooter.group, barrier.group, police.group, ...people]) {
    o.traverse((m) => (m.castShadow = true));
    scene.add(o);
  }
  const checkpoint: Checkpoint = { shooter, people, barrier, police, s: guardS };

  // The security camera on its pole, at the side of the valley road.
  const post = makeCameraPost();
  post.group.position.set(CAMERA_POST.x, heightAt(CAMERA_POST.x, CAMERA_POST.z), CAMERA_POST.z);
  post.group.traverse((o) => (o.castShadow = true));
  scene.add(post.group);

  // The volleyball court: a player in the middle, and a camera by its side, out of his reach.
  const courtDef = stations.find((st) => st.model === 'court');
  const cameras: { head: THREE.Object3D; watch: 'checkpoint' | 'court' }[] = [{ head: post.head, watch: 'checkpoint' }];
  let court: Court | null = null;
  if (courtDef) {
    const hitter = makeHitter();
    const y = heightAt(courtDef.x, courtDef.z) + 0.2;
    hitter.group.position.set(courtDef.x, y, courtDef.z);
    hitter.group.traverse((o) => (o.castShadow = true));
    scene.add(hitter.group, hitter.ball);
    const plant = makeFlytrap();
    plant.position.set(courtDef.x, y - 0.2, courtDef.z);
    plant.visible = false;
    plant.traverse((o) => (o.castShadow = true));
    scene.add(plant);
    court = { hitter, plant, x: courtDef.x, z: courtDef.z };
    const b = Math.atan2(courtDef.x, -courtDef.z) + rad(45);
    const at = polar(b, Math.hypot(courtDef.x, courtDef.z) + 18);
    const courtPost = makeCameraPost();
    courtPost.group.position.set(at.x, heightAt(at.x, at.z), at.z);
    courtPost.group.traverse((o) => (o.castShadow = true));
    scene.add(courtPost.group);
    cameras.push({ head: courtPost.head, watch: 'court' });
  }

  // The landing on the islet, out toward the island.
  const pier = makePier(16);
  pier.position.set(ISLET_DOCK.x, 0.2, ISLET_DOCK.z);
  pier.rotation.y = -ISLET_BEARING;
  scene.add(pier);

  // ---------- Places ----------

  const siteMaterial = lit('site');
  const siteRing = tint('accent', 0.35);
  const sites: Site[] = stations.map((def) => {
    const y = groundOf.get(def.id)!;
    const built = buildStation(def);
    const scale = def.scale;
    const h = built.h * scale;
    const group = built.group;
    group.position.set(def.x, y, def.z);
    group.rotation.y = def.yaw;
    group.scale.setScalar(scale);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !((o as THREE.Mesh).material as THREE.Material).transparent) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(group);
    if (built.update) animated.push(built.update);

    if (!def.sea && !def.inside) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(def.r, 40), siteMaterial);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(def.x, y + 0.03, def.z);
      pad.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.RingGeometry(def.r - 0.18, def.r, 48), siteRing);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(def.x, y + 0.06, def.z);
      scene.add(pad, ring);
    }

    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    bounds.max.y = Math.max(bounds.max.y, y + h);

    // Places under a roof get a diamond just above them, without the beam.
    const { diamond, beam } = makeBeacon();
    const beacon = new THREE.Group();
    const top = def.inside ? h + 1.6 : h + 5;
    diamond.position.y = top;
    beam.scale.y = top - 1;
    beam.position.y = (top - 1) / 2;
    beacon.add(diamond);
    if (!def.inside) beacon.add(beam);
    beacon.position.set(def.x, y, def.z);
    scene.add(beacon);
    animated.push((t) => {
      diamond.position.y = top + Math.sin(t * 2 + def.x) * 0.4;
      diamond.rotation.y = t * 1.5;
    });

    const cos = Math.cos(def.yaw);
    const sin = Math.sin(def.yaw);
    const solid = (built.solid ?? []).map(([lx, lz, r, top]) => {
      const wx = def.x + (lx * cos + lz * sin) * scale;
      const wz = def.z + (-lx * sin + lz * cos) * scale;
      return [wx, wz, r * scale, y + top * scale] as [number, number, number, number];
    });
    const roofs = (built.roofs ?? []).map(([lx, lz, hw, hd, ceiling, top]) => ({
      x: def.x + (lx * cos + lz * sin) * scale,
      z: def.z + (-lx * sin + lz * cos) * scale,
      cos,
      sin,
      hw: hw * scale,
      hd: hd * scale,
      ceiling: y + ceiling * scale,
      top: y + top * scale,
    }));

    return { def, y, h, built, group, bounds, beacon, solid, roofs };
  });

  // ---------- Year gates ----------

  for (const gate of gates) {
    const g = makeGate();
    const y = heightAt(gate.x, gate.z);
    g.position.set(gate.x, y, gate.z);
    g.rotation.y = gate.yaw;
    g.traverse((o) => (o.castShadow = true));
    const tag = label(gate.label);
    tag.position.set(gate.x, y + 8.2, gate.z);
    scene.add(g, tag);
  }

  // ---------- Scenery ----------

  const random = rng(2024);
  const plan: SceneryPlan = { pines: [], broadleaf: [], bushes: [], flowers: [], grass: [], rocks: [] };
  const clear = (x: number, z: number, margin: number) =>
    stations.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + margin) && roadDistance(x, z) > ROAD_HALF + margin && Math.hypot(x - CAVE.x, z - CAVE.z) > 6 + margin;
  const anywhere = () => ({ x: (random() * 2 - 1) * (WORLD_R - 10), z: (random() * 2 - 1) * (WORLD_R - 10) });
  /** Clumps: woods and meadows alternate across the land. */
  const wooded = (x: number, z: number) => Math.sin(x * 0.05) * Math.cos(z * 0.045) > -0.25;

  // Woods: pines on the heights, round trees mixed in down in the lowland.
  for (let tries = 0; tries < 16000 && plan.pines.length + plan.broadleaf.length < 1500; tries++) {
    const p = anywhere();
    const h = baseHeight(p.x, p.z);
    if (h < 1.6 || h > 30) continue;
    if (!wooded(p.x, p.z) && random() > 0.2) continue;
    if (!clear(p.x, p.z, 3.5)) continue;
    const item = [p.x, heightAt(p.x, p.z) - 0.1, p.z, 0.8 + random() * 0.9];
    (h > 9 || random() < 0.45 ? plan.pines : plan.broadleaf).push(item);
  }
  // Bushes at the edges of the woods and along the roads.
  for (let tries = 0; tries < 12000 && plan.bushes.length < 800; tries++) {
    const p = anywhere();
    const h = baseHeight(p.x, p.z);
    if (h < 0.9 || h > 26 || !clear(p.x, p.z, 1.6)) continue;
    plan.bushes.push([p.x, heightAt(p.x, p.z) - 0.1, p.z, 0.7 + random() * 0.9]);
  }
  // Meadows: grass everywhere, flowers in patches.
  for (let tries = 0; tries < 16000 && plan.grass.length < 3000; tries++) {
    const p = anywhere();
    const h = baseHeight(p.x, p.z);
    if (h < 0.7 || h > 28 || !clear(p.x, p.z, 0.6)) continue;
    plan.grass.push([p.x, heightAt(p.x, p.z) - 0.05, p.z, 0.6 + random() * 0.5]);
  }
  for (let patches = 0, tries = 0; tries < 4000 && patches < 260; tries++) {
    const c = anywhere();
    const h = baseHeight(c.x, c.z);
    if (h < 0.9 || h > 26 || wooded(c.x, c.z)) continue;
    patches++;
    for (let i = 0; i < 9; i++) {
      const x = c.x + (random() * 2 - 1) * 3.5;
      const z = c.z + (random() * 2 - 1) * 3.5;
      if (!clear(x, z, 0.5)) continue;
      plan.flowers.push([x, heightAt(x, z) + 0.12, z, 0.8 + random() * 0.6]);
    }
  }
  // Rocks along both shores, boulders on the slopes of the mountain and on the ridge.
  for (let i = 0; i < 200; i++) {
    const b = random() * TAU;
    const p = i % 4 === 3 ? isletShore(b, -2 + random() * 7) : polar(b, coastRadius(b) - 2 + random() * 7);
    if (!clear(p.x, p.z, 2)) continue;
    plan.rocks.push([p.x, Math.max(heightAt(p.x, p.z), -1), p.z, 0.5 + random() * 1.6]);
  }
  for (let tries = 0; tries < 3000 && plan.rocks.length < 420; tries++) {
    const p = polar(random() * TAU, 60 + random() * 140);
    const h = baseHeight(p.x, p.z);
    if (h < 9 || !clear(p.x, p.z, 2)) continue;
    plan.rocks.push([p.x, heightAt(p.x, p.z) - 0.3, p.z, 1 + random() * 2.2]);
  }
  const scenery = makeScenery(plan, PALETTE.low);
  scene.add(scenery);

  // The secret stash, on the top of the mountain.
  const stash = makeStash();
  stash.position.set(CAVE.x, heightAt(CAVE.x, CAVE.z), CAVE.z);
  stash.traverse((o) => (o.castShadow = true));
  scene.add(stash);

  // The wall of boulders across the plateau, past the tourists.
  const walls: [number, number, number, number][] = [];
  const boulderRandom = rng(301);
  const wall = part((k) => {
    for (const b of BOULDERS) {
      const y = heightAt(b.x, b.z);
      const size = 2.8 + boulderRandom() * 0.8;
      k.put('rock', new THREE.IcosahedronGeometry(1, 2), b.x, y + size * 0.55, b.z, boulderRandom() * 3, boulderRandom() * 3, 0, size, size * 0.9, size * 1.05);
      walls.push([b.x, b.z, size * 0.95, y + size * 1.4]);
    }
  });
  wall.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  scene.add(wall);

  // ---------- Activities ----------
  // Lega del Filo d'Oro: data packets scattered around the quarter, to gather into a pipeline
  // that lights up a dashboard. Inim: four sensors around the office to switch on, then the
  // control panel to arm the system.

  const stationAt = (model: string) => stations.find((st) => st.model === model);
  const free = (x: number, z: number, margin: number) => stations.every((st) => Math.hypot(x - st.x, z - st.z) > st.r + margin);
  const front = (st: StationDef, out: number) => ({ x: st.x + Math.sin(st.yaw) * out, z: st.z + Math.cos(st.yaw) * out });
  const placeOn = (object: THREE.Object3D, x: number, z: number, yaw = 0) => {
    object.position.set(x, heightAt(x, z), z);
    object.rotation.y = yaw;
    object.traverse((o) => (o.castShadow = true));
    scene.add(object);
    return object;
  };
  const tasks: World['tasks'] = { lfo: null, inim: null };
  const lfoDef = stationAt('residential');
  if (lfoDef) {
    const cubes: THREE.Object3D[] = [];
    for (let i = 0; i < 24 && cubes.length < 5; i++) {
      const a = (i / 24) * TAU + (i % 2) * 0.13;
      const d = lfoDef.r + 6 + (i % 3) * 3;
      const x = lfoDef.x + Math.sin(a) * d;
      const z = lfoDef.z - Math.cos(a) * d;
      // On the top of the mountain, away from the court and its player, clear of the other places.
      if (Math.hypot(x, z) > 58 || (court && Math.hypot(x - court.x, z - court.z) < 42) || !free(x, z, 3)) continue;
      if (cubes.some((c) => Math.hypot(c.position.x - x, c.position.z - z) < 9)) continue;
      cubes.push(placeOn(makeDataCube(), x, z));
    }
    const at = front(lfoDef, lfoDef.r + 4);
    const dashboard = placeOn(makeDashboard(), at.x, at.z, lfoDef.yaw);
    dashboard.visible = false;
    tasks.lfo = { cubes, dashboard };
  }
  const inimDef = stationAt('office');
  if (inimDef) {
    const sensors = [45, 135, 225, 315].map((deg) => {
      const a = inimDef.yaw + (deg * Math.PI) / 180;
      return placeOn(makeSensor(), inimDef.x + Math.sin(a) * (inimDef.r + 5), inimDef.z + Math.cos(a) * (inimDef.r + 5));
    });
    const at = front(inimDef, inimDef.r + 3);
    const panel = placeOn(makePanel(), at.x, at.z, inimDef.yaw);
    tasks.inim = { sensors, panel };
  }

  // ---------- Explosions ----------
  // A fireball and a shock ring that grow and fade, a crater, and everything near torn apart:
  // trees and bushes are gone, buildings slump into ruins, litter is blown away. Nothing is
  // saved: the island is whole again on the next visit.

  let now = 0;
  const fireGeometry = new THREE.IcosahedronGeometry(1, 2);
  const booms: { at: number; r: number; fire: THREE.Mesh; ring: THREE.Mesh }[] = [];
  function blast(x: number, z: number, r: number) {
    const y = Math.max(heightAt(x, z), 0);
    const fire = new THREE.Mesh(fireGeometry, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    fire.position.set(x, y + 1, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.4, z);
    scene.add(fire, ring);
    booms.push({ at: now, r, fire, ring });
    // The crater: as deep as the land allows, never below the sea.
    const depth = Math.min(3.5, heightAt(x, z) - 0.7);
    if (depth > 0.3) {
      const cr = r * 0.6;
      craters.push({ x, z, r: cr, depth });
      const burnt = new THREE.Color(0x4a3526);
      const col = new THREE.Color();
      for (let i = 0; i < gp.count; i++) {
        const vx = gp.getX(i);
        const vz = gp.getZ(i);
        const d = Math.hypot(vx - x, vz - z);
        if (d > cr + 1) continue;
        const h = heightAt(vx, vz);
        gp.setY(i, h);
        heights[i] = h;
        col.fromArray(groundColors, i * 3).lerp(burnt, 0.85 * smoothstep(cr, cr * 0.35, d));
        col.toArray(groundColors, i * 3);
      }
      gp.needsUpdate = true;
      ground.attributes.color.needsUpdate = true;
      ground.computeVertexNormals();
    }
    (scenery.userData.blast as (x: number, z: number, r: number) => void)(x, z, r);
    const ruined: Site[] = [];
    for (const site of sites) {
      // The machines stay whole: the way through the island must not be lost.
      if (site.def.sea || site.built.vehicles?.length || site.group.userData.ruined) continue;
      if (Math.hypot(site.def.x - x, site.def.z - z) > r + site.def.r * 0.4) continue;
      site.group.userData.ruined = true;
      site.group.scale.y *= 0.16;
      site.group.rotation.x = (Math.random() - 0.5) * 0.12;
      site.group.rotation.z = (Math.random() - 0.5) * 0.12;
      site.solid.length = 0;
      ruined.push(site);
    }
    let cleared = 0;
    for (const pile of litter) {
      if (pile.object.visible && Math.hypot(pile.x - x, pile.z - z) < r) {
        pile.object.visible = false;
        cleared++;
      }
    }
    return { ruined, cleared };
  }
  animated.push((t) => {
    now = t;
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      const f = (t - b.at) / 0.8;
      if (f >= 1) {
        scene.remove(b.fire, b.ring);
        (b.fire.material as THREE.Material).dispose();
        (b.ring.material as THREE.Material).dispose();
        b.ring.geometry.dispose();
        booms.splice(i, 1);
        continue;
      }
      b.fire.scale.setScalar(1.5 + Math.sqrt(f) * b.r * 0.6);
      (b.fire.material as THREE.MeshBasicMaterial).opacity = 1 - f;
      (b.fire.material as THREE.MeshBasicMaterial).color.setHSL(0.09 - f * 0.07, 1, 0.6 - f * 0.25);
      b.ring.scale.setScalar(1 + f * b.r * 1.5);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
    }
  });

  // Clouds, drifting slowly high over the island.
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa7b4, fog: false, transparent: true, opacity: 0.95 });
  const CLOUDS = 46;
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), cloudMaterial, CLOUDS * 4);
  const puffAt = new THREE.Object3D();
  for (let i = 0; i < CLOUDS; i++) {
    const c = polar(random() * TAU, 60 + random() * 460);
    const y = 85 + random() * 45;
    const size = 6 + random() * 8;
    for (let j = 0; j < 4; j++) {
      puffAt.position.set(c.x + (j - 1.5) * size * 0.9, y + (j % 2) * size * 0.25, c.z + (random() - 0.5) * size);
      puffAt.scale.set(size * (0.8 + random() * 0.5), size * 0.45, size * (0.7 + random() * 0.4));
      puffAt.updateMatrix();
      clouds.setMatrixAt(i * 4 + j, puffAt.matrix);
    }
  }
  scene.add(clouds);
  animated.push((t) => (clouds.rotation.y = t * 0.004));

  // ---------- Theme ----------

  onPalette((p) => {
    skyUniforms.zenith.value.set(p.zenith);
    skyUniforms.horizon.value.set(p.horizon);
    skyUniforms.glow.value.set(p.sunGlow);
    const fog = scene.fog as THREE.Fog;
    fog.color.set(p.horizon);
    fog.near = p.fogNear;
    fog.far = p.fogFar;
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemi;
    sun.intensity = p.sun;
    sun.color.set(p.sunColor);
  });

  return {
    scene,
    sun,
    sites,
    litter,
    crowd,
    checkpoint,
    court,
    cameras,
    walls,
    tasks,
    heightAt,
    blast,
    update: (t) => {
      shaderTime.value = t;
      animated.forEach((fn) => fn(t));
    },
  };
}

export { WORLD_R };
