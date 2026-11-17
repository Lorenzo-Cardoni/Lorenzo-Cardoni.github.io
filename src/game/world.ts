// Builds the scene: sky, sea, the island's ground and roads, the places, the year gates and the scenery.
import * as THREE from 'three';
import {
  ROAD_HALF,
  TAU,
  WORLD_R,
  avenue,
  startPath,
  baseHeight,
  bearingOf,
  coastRadius,
  lerp,
  mainRoad,
  polar,
  rng,
  roadDistance,
  smoothstep,
  type Pt,
} from './layout';
import { onPalette, tint, type Palette } from './palette';
import { buildStation, makeBeacon, makeGate, makeScenery, type Built } from './models';
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

export interface World {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  sites: Site[];
  heightAt: (x: number, z: number) => number;
  update: (t: number) => void;
}

/** An opaque lit material in a palette color that follows the theme. */
function lit(key: keyof Palette, flat = true): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ flatShading: flat });
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

  const heightAt = (x: number, z: number): number => {
    let h = baseHeight(x, z);
    for (const s of levelled) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r + 9) h = lerp(h, s.y, smoothstep(s.r + 9, s.r + 1, d));
    }
    return h;
  };

  // ---------- Sky ----------

  const skyUniforms = { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDir; void main() { float t = smoothstep(0.0, 0.75, vDir.y); gl_FragColor = vec4(mix(horizon, zenith, t), 1.0); }',
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const starGeometry = new THREE.BufferGeometry();
  const starRandom = rng(99);
  const starPositions: number[] = [];
  for (let i = 0; i < 700; i++) {
    const a = starRandom() * TAU;
    const y = 0.08 + starRandom() * 0.92;
    const r = Math.sqrt(1 - y * y);
    starPositions.push(Math.cos(a) * r * 800, y * 800, Math.sin(a) * r * 800);
  }
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);

  scene.fog = new THREE.Fog(0, 220, 700);

  // ---------- Light ----------

  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
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
  const groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
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
      else c.set(p.low).lerp(c2.set(p.high), smoothstep(2, 11, h));
      c.toArray(groundColors, i * 3);
    }
    ground.attributes.color.needsUpdate = true;
  });

  // ---------- Sea ----------

  const water = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.86 }));
  onPalette((p) => (water.material as THREE.MeshLambertMaterial).color.set(p.water));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.receiveShadow = true;
  scene.add(water);

  const coastLoop = (extra: number, y: number) => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 240; i++) {
      const b = (i / 240) * TAU;
      const p = polar(b, coastRadius(b) + extra);
      points.push(new THREE.Vector3(p.x, y, p.z));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  };
  const shoreMaterial = new THREE.LineBasicMaterial({ transparent: true });
  onPalette((p) => {
    shoreMaterial.color.set(p.shore);
    shoreMaterial.opacity = 0.7;
  });
  scene.add(new THREE.LineLoop(coastLoop(-0.6, 0.08), shoreMaterial));

  const swells = [4, 11, 20, 32].map((extra) => {
    const material = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
    const loop = new THREE.LineLoop(coastLoop(extra, 0.05), material);
    scene.add(loop);
    return { loop, material, extra };
  });
  let waveAlpha = 0.2;
  onPalette((p) => {
    waveAlpha = p.waterLineA;
    swells.forEach(({ material }) => material.color.set(p.waterLine));
  });
  animated.push((t) =>
    swells.forEach(({ loop, material }, i) => {
      const f = (t * 0.05 + i / swells.length) % 1;
      loop.scale.setScalar(1 + f * 0.06);
      material.opacity = waveAlpha * Math.sin(f * Math.PI);
    }),
  );

  // ---------- Roads ----------

  const roadMaterial = lit('road', false);
  const edgeMaterial = lit('roadEdge', false);
  const start = resample(startPath, 2);
  const roads = [resample(mainRoad.pts, 2), resample(avenue, 2), start];
  for (const pts of roads) {
    const road = new THREE.Mesh(ribbon(pts, -ROAD_HALF, ROAD_HALF, heightAt, 0.05), roadMaterial);
    road.receiveShadow = true;
    scene.add(road);
    for (const s of [-1, 1]) {
      scene.add(new THREE.Mesh(ribbon(pts, s * (ROAD_HALF - 0.1), s * (ROAD_HALF - 0.35), heightAt, 0.08), edgeMaterial));
    }
  }
  // The timeline road carries a dashed accent line, like a time axis.
  const dashes: Pt[][] = [];
  const main = roads[0];
  for (let i = 0; i + 2 < main.length; i += 3) dashes.push([main[i], main[i + 1], main[i + 2]]);
  const dashMaterial = tint('accent', 0.75);
  for (const dash of dashes) scene.add(new THREE.Mesh(ribbon(dash, -0.16, 0.16, heightAt, 0.1), dashMaterial));

  // The start path glows, with chevrons that run toward the first year of the timeline.
  scene.add(new THREE.Mesh(ribbon(start, -0.35, 0.35, heightAt, 0.1), tint('accent', 0.9)));
  const chevron = new THREE.BufferGeometry();
  chevron.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1.3, 1.6, 0, 0.4, 0, 0, -0.2, 0, 0, -1.3, 0, 0, -0.2, -1.6, 0, 0.4], 3));
  const chevronMaterial = tint('accent', 0.9, true);
  const chevrons: { mesh: THREE.Mesh; i: number }[] = [];
  for (let i = 4; i < start.length - 2; i += 6) {
    const a = start[i];
    const b = start[i + 1];
    const mesh = new THREE.Mesh(chevron, chevronMaterial);
    mesh.position.set(a.x, heightAt(a.x, a.z) + 0.16, a.z);
    mesh.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    scene.add(mesh);
    chevrons.push({ mesh, i });
  }
  animated.push((t) =>
    chevrons.forEach(({ mesh, i }) => {
      const wave = 0.5 + 0.5 * Math.sin(t * 4 - i * 0.35);
      mesh.scale.setScalar(0.8 + wave * 0.45);
    }),
  );

  // ---------- Places ----------

  const siteMaterial = lit('site', false);
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
  const trees: number[][] = [];
  const rocks: number[][] = [];
  const clear = (x: number, z: number, margin: number) =>
    stations.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + margin) && roadDistance(x, z) > ROAD_HALF + margin;

  for (let tries = 0; tries < 6000 && trees.length < 820; tries++) {
    const b = random() * TAU;
    const r = 22 + Math.sqrt(random()) * 185;
    const p = polar(b, r);
    const inland = coastRadius(bearingOf(p.x, p.z)) - r;
    if (inland < 7) continue;
    // Trees grow in clumps.
    if (Math.sin(p.x * 0.05) * Math.cos(p.z * 0.045) < -0.25 && random() > 0.25) continue;
    if (!clear(p.x, p.z, 3.5)) continue;
    trees.push([p.x, heightAt(p.x, p.z) - 0.1, p.z, 0.8 + random() * 0.9]);
  }
  for (let i = 0; i < 140; i++) {
    const b = random() * TAU;
    const r = coastRadius(b) - 2 + random() * 7;
    const p = polar(b, r);
    if (!clear(p.x, p.z, 2)) continue;
    rocks.push([p.x, Math.max(heightAt(p.x, p.z), -1), p.z, 0.5 + random() * 1.6]);
  }
  const scenery = makeScenery(trees, rocks);
  scenery.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  scene.add(scenery);

  // ---------- Theme ----------

  onPalette((p) => {
    skyUniforms.zenith.value.set(p.zenith);
    skyUniforms.horizon.value.set(p.horizon);
    (scene.fog as THREE.Fog).color.set(p.horizon);
    starMaterial.opacity = p.stars;
    stars.visible = p.stars > 0;
    starMaterial.color.set(0xffffff);
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemi;
    sun.intensity = p.sun;
    sun.color.set(0xffffff);
  });

  return {
    scene,
    sun,
    sites,
    heightAt,
    update: (t) => animated.forEach((fn) => fn(t)),
  };
}

export { WORLD_R };
