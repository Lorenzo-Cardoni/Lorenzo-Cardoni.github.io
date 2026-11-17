// The game loop of /play: flight, camera, detection of places, the log of what has been found,
// and the HTML interface around the canvas (src/pages/play.astro).
import * as THREE from 'three';
import { WORLD_R, angDiff, clamp, coastRadius, lerp, mainRoad, avenue, TAU, polar } from './layout';
import { PALETTES, applyPalette, type ThemeName } from './palette';
import { makeBike, makeBoat, makeCar, makeDrone, type VehicleKind } from './models';
import { buildWorld, underRoof, type Roof, type Site } from './world';
import type { Gate, StationDef } from './stations';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

const STORE = 'island-log';
const MIN_CLEAR = 1.6;
const MAX_ALT = 80;
const LOCK_SECONDS = 0.9;

const root = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Phones and tablets: a finger is the main pointer. Asked each time, for devices that switch. */
const touchFirst = () => window.matchMedia('(pointer: coarse)').matches;

// ---------- Log of found places ----------

const log = new Set<string>();
try {
  for (const id of JSON.parse(localStorage.getItem(STORE) || '[]')) log.add(String(id));
} catch {
  // Storage unavailable: the log lasts for this visit.
}
const saveLog = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify([...log]));
  } catch {
    // ignore
  }
};

// ---------- Panels (work with or without WebGL) ----------

const sheet = $('#sheet')!;
const places = $<HTMLDialogElement>('#places')!;
const intro = $('#intro')!;
const toastEl = $('#toast')!;
let sheetOpen: string | null = null;
let toastTimer = 0;

function toast(text: string) {
  toastEl.textContent = text;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), 3200);
}

function openSheet(id: string) {
  const article = $(`[data-entry="${CSS.escape(id)}"]`);
  if (!article) return;
  $$('[data-entry]').forEach((a) => (a.hidden = a !== article));
  sheet.hidden = false;
  sheet.scrollTop = 0;
  sheetOpen = id;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  $('[data-close-sheet]')?.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheetOpen) return;
  sheet.classList.remove('is-open');
  sheet.hidden = true;
  sheetOpen = null;
  canvasFocus();
}

let canvasFocus = () => {};

$$('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheet));
$$('[data-open-places]').forEach((b) =>
  b.addEventListener('click', () => {
    refreshPlaces();
    places.showModal();
  }),
);
places.addEventListener('click', (e) => {
  if (e.target === places) places.close();
});

function refreshPlaces() {
  $$('[data-place]').forEach((li) => li.classList.toggle('is-done', log.has(li.dataset.place!)));
}

// Theme: shared with the rest of the site.
const themeName = (): ThemeName => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
let onTheme = (_name: ThemeName) => {};
$$('[data-theme-toggle]').forEach((b) =>
  b.addEventListener('click', () => {
    const next = themeName() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    document.getElementById('theme-color')?.setAttribute('content', next === 'dark' ? '#090c0b' : '#f5f7f3');
    try {
      localStorage.setItem('theme', next);
    } catch {
      // ignore
    }
    onTheme(next);
  }),
);

// Full screen, where the browser allows it (not on the iPhone): on a phone it hides the address bar.
const fullBtn = $('[data-fullscreen]');
if (fullBtn && document.fullscreenEnabled && touchFirst()) {
  fullBtn.hidden = false;
  fullBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const full = !!document.fullscreenElement;
    document.body.classList.toggle('is-full', full);
    fullBtn.setAttribute('aria-label', full ? 'Leave full screen' : 'Full screen');
  });
}

// ---------- WebGL ----------

const data = JSON.parse($('#game-data')!.textContent || '{}') as { stations: StationDef[]; gates: Gate[] };
const total = data.stations.length;
const countEl = $('#hud-count')!;
const updateCount = () => {
  countEl.textContent = String([...log].filter((id) => data.stations.some((s) => s.id === id)).length);
  refreshPlaces();
};
updateCount();

let renderer: THREE.WebGLRenderer | null = null;
try {
  const probe = document.createElement('canvas');
  if (probe.getContext('webgl2') || probe.getContext('webgl')) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  }
} catch {
  renderer = null;
}

if (!renderer) {
  // No 3D: the places index becomes a table of contents that opens each entry directly.
  document.body.classList.add('no-gl');
  $$('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      places.close();
      openSheet(b.dataset.goto!);
    }),
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
} else {
  start(renderer);
}

function start(renderer: THREE.WebGLRenderer) {
  const stage = $('#stage')!;
  // Phones start at a lighter resolution; see Quality below.
  let pixelRatio = Math.min(window.devicePixelRatio, touchFirst() ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D island. Use the places list to travel with the keyboard or a screen reader.');
  stage.appendChild(renderer.domElement);
  canvasFocus = () => renderer.domElement.focus({ preventScroll: true });

  applyPalette(themeName());
  const world = buildWorld(data.stations, data.gates);
  const { scene, sun, sites, heightAt } = world;
  if (touchFirst()) sun.shadow.mapSize.set(1024, 1024);
  onTheme = (name) => {
    applyPalette(name);
    drawMapBase();
  };

  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1600);

  // ---------- Drone ----------

  const drone = makeDrone();
  drone.group.rotation.order = 'YXZ';
  drone.group.traverse((o) => (o.castShadow = true));
  scene.add(drone.group);

  const home = sites.find((s) => s.def.id === 'profile');
  const pos = new THREE.Vector3(home ? home.def.x + 4 : 0, (home?.y ?? 6) + 1.4, home ? home.def.z + 14 : 20);
  const vel = new THREE.Vector3();
  let heading = 0;
  let vy = 0;
  let camDist = 14;
  let camYaw = 0;
  let camPitch = 0.32;

  for (const s of sites) s.beacon.visible = !log.has(s.def.id);

  // ---------- Vehicles ----------
  // The drone, plus the vehicles found on the island: the Bosch car, the e-bike and the GeoPosBall boat.

  type Vehicle = { kind: VehicleKind; object: THREE.Object3D };
  const SPEC: Record<VehicleKind, { name: string; top: number; accel: number; turn: number; cam: number }> = {
    drone: { name: 'drone', top: 28, accel: 38, turn: 1.9, cam: 14 },
    car: { name: 'car', top: 30, accel: 20, turn: 1.7, cam: 10 },
    bike: { name: 'e-bike', top: 17, accel: 14, turn: 2.1, cam: 8 },
    boat: { name: 'boat', top: 20, accel: 9, turn: 1.0, cam: 14 },
  };
  const rigs: Record<VehicleKind, THREE.Object3D> = { drone: drone.group, car: makeCar(), bike: makeBike(), boat: makeBoat() };
  for (const k of ['car', 'bike', 'boat'] as const) {
    const rig = rigs[k];
    rig.rotation.order = 'YXZ';
    rig.visible = false;
    rig.traverse((o) => (o.castShadow = true));
    scene.add(rig);
  }
  const parked: Vehicle[] = sites.flatMap((s) => s.built.vehicles ?? []);
  let kind: VehicleKind = 'drone';
  let taken: Vehicle | null = null;
  let spd = 0;
  let rigScale = 1;
  let warnedAt = -10;
  const vp = new THREE.Vector3();
  const vd = new THREE.Vector3();

  function warn(text: string) {
    if (time - warnedAt < 3) return;
    warnedAt = time;
    toast(text);
  }

  function nearbyVehicle(): Vehicle | null {
    if (kind === 'drone' && pos.y - Math.max(heightAt(pos.x, pos.z), 0) > 16) return null;
    const reach = kind === 'drone' ? 16 : 10;
    let best: Vehicle | null = null;
    let bestD = reach;
    for (const v of parked) {
      if (v === taken) continue;
      v.object.getWorldPosition(vp);
      const d = Math.hypot(vp.x - pos.x, vp.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  function setKind(next: VehicleKind) {
    rigs[kind].visible = false;
    kind = next;
    rigs[kind].visible = true;
    camDist = SPEC[kind].cam * (kind === 'drone' ? 1 : rigScale);
    document.body.dataset.vehicle = kind;
  }

  function board(v: Vehicle) {
    if (taken) taken.object.visible = true;
    // The visitor's copy matches the size of the one parked on the island.
    v.object.getWorldScale(vd);
    rigScale = vd.x;
    rigs[v.kind].scale.setScalar(rigScale);
    v.object.getWorldPosition(vp);
    vd.set(0, 0, 1).transformDirection(v.object.matrixWorld);
    heading = Math.atan2(-vd.x, -vd.z);
    pos.set(vp.x, v.kind === 'boat' ? 0 : heightAt(vp.x, vp.z), vp.z);
    v.object.visible = false;
    taken = v;
    autopilot = null;
    spd = 0;
    vel.set(0, 0, 0);
    vy = 0;
    setKind(v.kind);
    toast(`You took the ${SPEC[v.kind].name}. ${touchFirst() ? 'Tap “Back to the drone” to fly again.' : 'Press E to get back on the drone.'}`);
  }

  function toDrone(quiet = false) {
    if (kind === 'drone') return;
    if (taken) taken.object.visible = true;
    taken = null;
    vel.set(-Math.sin(heading) * spd, 0, -Math.cos(heading) * spd);
    spd = 0;
    pos.y = Math.max(pos.y, 0) + 2.5;
    setKind('drone');
    if (!quiet) toast('Back on the drone.');
  }

  function swap() {
    const v = nearbyVehicle();
    if (v) board(v);
    else if (kind !== 'drone') toDrone();
    else warn('No vehicle nearby. Fly low next to the car, the e-bike or the boat.');
  }
  $$('[data-ride]').forEach((b) => b.addEventListener('click', swap));

  // ---------- Input ----------

  const keys = new Set<string>();
  const stick = { x: 0, y: 0 };
  let rise = 0;
  let playing = false;

  const isTyping = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest?.('input, textarea, select');
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (e.key === 'Escape') {
      if (sheetOpen) closeSheet();
      return;
    }
    if (!playing || sheetOpen || places.open) return;
    if (e.key === 'Enter' && target) {
      e.preventDefault();
      openSheet(target.def.id);
      return;
    }
    if (e.key === 'p' || e.key === 'P') {
      refreshPlaces();
      places.showModal();
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'e') {
      if (!e.repeat) swap();
      return;
    }
    if (['w', 'a', 's', 'd', 'r', 'f', ' ', 'Shift', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      keys.add(k);
      autopilot = null;
      if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener('blur', () => keys.clear());

  // Drag to look around, pinch or wheel to zoom; the camera eases back behind the drone once it moves.
  const canvas = renderer.domElement;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const spread = () => {
    const [p, q] = [...pointers.values()];
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    pinch = pointers.size === 2 ? spread() : 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch) {
      const d = spread();
      camDist = clamp(camDist * (pinch / Math.max(d, 1)), 6, 40);
      pinch = d;
    } else if (pointers.size === 1) {
      // A finger covers less ground than a mouse, so it turns the view a little faster.
      const k = e.pointerType === 'touch' ? 1.5 : 1;
      camYaw -= dx * 0.006 * k;
      camPitch = clamp(camPitch + dy * 0.004 * k, -0.15, 1.2);
    }
  });
  const endDrag = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = pointers.size === 2 ? spread() : 0;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // No long-press menu over the game.
  $('.game')?.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest('.sheet, .places, .intro')) e.preventDefault();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camDist = clamp(camDist * Math.exp(e.deltaY * 0.001), 6, 40);
    },
    { passive: false },
  );

  // Touch: a stick on the left, rise and sink buttons on the right.
  const stickEl = $('#stick');
  const knob = $('#stick-knob');
  if (stickEl && knob) {
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = stickEl.getBoundingClientRect();
      const half = r.width / 2;
      let x = (e.clientX - r.left - half) / half;
      let y = (e.clientY - r.top - half) / half;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      // A small dead zone, so a resting thumb does not drift, then a gentle curve for fine moves.
      const DEAD = 0.14;
      const reach = Math.min(len, 1);
      const out = reach > DEAD ? ((reach - DEAD) / (1 - DEAD)) ** 1.4 : 0;
      stick.x = reach ? (x / reach) * out : 0;
      stick.y = reach ? (y / reach) * out : 0;
      knob.style.transform = `translate(${x * half * 0.6}px, ${y * half * 0.6}px)`;
    };
    stickEl.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stickEl.setPointerCapture(e.pointerId);
      autopilot = null;
      move(e);
    });
    stickEl.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const release = () => {
      id = null;
      stick.x = stick.y = 0;
      knob.style.transform = '';
    };
    stickEl.addEventListener('pointerup', release);
    stickEl.addEventListener('pointercancel', release);
    stickEl.addEventListener('lostpointercapture', release);
  }
  for (const [sel, dir] of [
    ['[data-rise]', 1],
    ['[data-sink]', -1],
  ] as const) {
    const b = $(sel);
    if (!b) continue;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      rise = dir;
      autopilot = null;
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => rise === dir && (rise = 0));
  }

  // ---------- Autopilot ----------

  let autopilot: Site | null = null;
  /** For a place under a roof: 0 while heading for the building's entrance, 1 once through it. */
  let autoPhase = 0;
  const flyTo = (site: Site) => {
    autopilot = site;
    autoPhase = 0;
  };
  const allRoofs: Roof[] = sites.flatMap((s) => s.roofs);
  const roofAt = (x: number, z: number) => allRoofs.find((roof) => underRoof(roof, x, z));
  $$('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      const site = sites.find((s) => s.def.id === b.dataset.goto);
      places.close();
      closeSheet();
      if (!site) return;
      if (!playing) begin();
      toDrone(true);
      flyTo(site);
      toast(`Flying to ${site.def.title}`);
    }),
  );
  $$('[data-next]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = nearestUnlogged();
      closeSheet();
      if (next) {
        toDrone(true);
        flyTo(next);
        toast(`Flying to ${next.def.title}`);
      } else toast('Every place is in the log.');
    }),
  );

  function nearestUnlogged(): Site | null {
    let best: Site | null = null;
    let bestD = Infinity;
    for (const s of sites) {
      if (log.has(s.def.id) || s.def.id === sheetOpen) continue;
      const d = Math.hypot(s.def.x - pos.x, s.def.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // ---------- Start ----------

  function begin() {
    playing = true;
    intro.hidden = true;
    document.body.classList.add('is-playing');
    canvasFocus();
    if (!log.size && data.gates[0]) toast(`Follow the lit path to ${data.gates[0].label}, where the timeline starts.`);
  }
  $$('[data-start]').forEach((b) => b.addEventListener('click', begin));
  $$('[data-help]').forEach((b) =>
    b.addEventListener('click', () => {
      playing = false;
      intro.hidden = false;
      document.body.classList.remove('is-playing');
      $('[data-start]')?.focus();
    }),
  );

  // ---------- Detection ----------

  const detect = $('#detect')!;
  const detectLabel = $('#detect-label')!;
  const prompt = $('#prompt')!;
  const promptTitle = $('#prompt-title')!;
  const promptSub = $('#prompt-sub')!;
  const altEl = $('#hud-alt')!;
  const rideEl = $('#ride')!;
  const rideLabel = $('#ride-label')!;
  const spdEl = $('#hud-spd')!;
  let target: Site | null = null;
  let lockTime = 0;

  $$('[data-open-entry]').forEach((b) => b.addEventListener('click', () => target && openSheet(target.def.id)));

  function findTarget(): Site | null {
    let best: Site | null = null;
    let bestScore = Infinity;
    for (const s of sites) {
      const dx = s.def.x - pos.x;
      const dz = s.def.z - pos.z;
      const d = Math.hypot(dx, dz);
      const reach = s.def.r + 13;
      if (d > reach || pos.y - s.y > 45) continue;
      // Places ahead of the drone count as closer.
      const ahead = d > 0.1 ? (-Math.sin(heading) * dx - Math.cos(heading) * dz) / d : 1;
      const score = d / reach - ahead * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  const corner = new THREE.Vector3();
  function placeBox(site: Site, confidence: number) {
    const b = site.bounds;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let behind = false;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
      if (corner.z > 1) behind = true;
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
    if (behind) {
      detect.hidden = true;
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const left = clamp(((minX + 1) / 2) * w, 8, w - 8);
    const right = clamp(((maxX + 1) / 2) * w, 8, w - 8);
    const top = clamp(((1 - maxY) / 2) * h, 30, h - 8);
    const bottom = clamp(((1 - minY) / 2) * h, 30, h - 8);
    // Too small to read, or so close that the box would frame the whole screen.
    if (right - left < 20 || bottom - top < 20 || (right - left > w * 0.8 && bottom - top > h * 0.7)) {
      detect.hidden = true;
      return;
    }
    detect.hidden = false;
    detect.style.transform = `translate(${left}px, ${top}px)`;
    detect.style.width = `${right - left}px`;
    detect.style.height = `${bottom - top}px`;
    detect.classList.toggle('is-locked', confidence >= 0.99);
    detectLabel.textContent = `${site.def.tag} ${confidence.toFixed(2)}`;
  }

  // ---------- Minimap ----------

  const map = $<HTMLCanvasElement>('#minimap');
  const mapBase = document.createElement('canvas');
  const MAP_PX = 168;
  const MAP_R = 236;
  const toMap = (x: number, z: number) => [MAP_PX / 2 + (x / MAP_R) * (MAP_PX / 2), MAP_PX / 2 + (z / MAP_R) * (MAP_PX / 2)];
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

  function drawMapBase() {
    if (!map) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    for (const c of [map, mapBase]) {
      c.width = MAP_PX * dpr;
      c.height = MAP_PX * dpr;
    }
    const p = PALETTES[themeName()];
    const ctx = mapBase.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_PX, MAP_PX);
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const b = (i / 120) * TAU;
      const q = polar(b, coastRadius(b));
      const [x, y] = toMap(q.x, q.z);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.fillStyle = hex(p.structure);
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hex(p.shore);
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const pts of [mainRoad.pts, avenue]) {
      ctx.beginPath();
      pts.forEach((q, i) => {
        const [x, y] = toMap(q.x, q.z);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = hex(p.road);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  drawMapBase();

  function drawMap() {
    if (!map) return;
    const p = PALETTES[themeName()];
    const dpr = map.width / MAP_PX;
    const ctx = map.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, map.width, map.height);
    ctx.drawImage(mapBase, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of sites) {
      const [x, y] = toMap(s.def.x, s.def.z);
      const done = log.has(s.def.id);
      ctx.fillStyle = done ? hex(p.light) : hex(p.accent);
      const size = s === target ? 6 : done ? 3 : 4;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.strokeStyle = hex(p.white);
    ctx.lineWidth = 1.5;
    for (const v of parked) {
      if (v === taken) continue;
      v.object.getWorldPosition(vp);
      const [vx, vy2] = toMap(vp.x, vp.z);
      ctx.beginPath();
      ctx.arc(vx, vy2, 3, 0, TAU);
      ctx.stroke();
    }
    const [x, y] = toMap(pos.x, pos.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-heading);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fillStyle = hex(p.signal);
    ctx.fill();
    ctx.restore();
  }

  // ---------- Resize ----------

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 70 : 58;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Quality ----------
  // If frames run slow after the start, the resolution drops a step at a time down to 1, then the
  // shadows go. It never climbs back, so the picture does not flicker between levels.

  let warmup = 0;
  let sampleTime = 0;
  let sampleFrames = 0;
  function tune(dt: number) {
    warmup += dt;
    if (warmup < 3) return;
    sampleTime += dt;
    sampleFrames++;
    if (sampleTime < 2) return;
    const average = sampleTime / sampleFrames;
    sampleTime = 0;
    sampleFrames = 0;
    // Below about 28 frames a second; a phone capped at 30 by its battery saver is left alone.
    if (average < 1 / 28) return;
    if (pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
    } else if (sun.castShadow) sun.castShadow = false;
  }

  // ---------- Loop ----------

  const forward = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const desired = new THREE.Vector3();
  let first = true;
  let last = performance.now();
  let time = 0;
  let hudTimer = 0;
  let mapTimer = 0;

  function step(dt: number) {
    // Controls: forward and back, turn, rise and sink.
    let fwd = 0;
    let turn = 0;
    let up = rise;
    if (playing && !sheetOpen) {
      if (keys.has('w') || keys.has('ArrowUp')) fwd += 1;
      if (keys.has('s') || keys.has('ArrowDown')) fwd -= 1;
      if (keys.has('a') || keys.has('ArrowLeft')) turn += 1;
      if (keys.has('d') || keys.has('ArrowRight')) turn -= 1;
      if (keys.has(' ') || keys.has('r')) up += 1;
      if (keys.has('Shift') || keys.has('f')) up -= 1;
      fwd -= stick.y;
      turn -= stick.x * 0.9;
    } else up = 0;

    const ground = Math.max(heightAt(pos.x, pos.z), 0);

    if (autopilot && kind === 'drone') {
      const s = autopilot;
      let tx = s.def.x;
      let tz = s.def.z;
      let arrive = s.def.r + 9;
      let cruise = Math.max(s.y + s.h + 7, ground + 14);
      // A place under a roof: through the entrance first, then along the aisle below the ceiling.
      const host = s.def.inside ? sites.find((h) => h.def.id === s.def.inside) : undefined;
      const roof = host?.roofs[0];
      if (host && roof) {
        cruise = s.y + Math.min(s.h + 1.4, roof.ceiling - s.y - 2);
        arrive = 4.5;
        if (autoPhase === 0) {
          const out = roof.hd + 12;
          tx = host.def.x + Math.sin(host.def.yaw) * out;
          tz = host.def.z + Math.cos(host.def.yaw) * out;
          arrive = 3;
        }
      }
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 80) cruise = Math.max(cruise, 30);
      const want = Math.atan2(-dx, -dz);
      const diff = angDiff(want, heading);
      turn = clamp(diff * 2.2, -1, 1);
      fwd = d > arrive ? clamp((d - arrive) / 14, 0.25, 1) * clamp(1.4 - Math.abs(diff), 0.15, 1) : 0;
      up = clamp((cruise - pos.y) / 4, -1, 1);
      if (d <= arrive && Math.abs(pos.y - cruise) < 3) {
        if (host && autoPhase === 0) autoPhase = 1;
        else {
          autopilot = null;
          vel.multiplyScalar(0.3);
          openSheet(s.def.id);
        }
      }
    }

    const spec = SPEC[kind];
    const prevX = pos.x;
    const prevY = pos.y;
    const prevZ = pos.z;
    let speed: number;
    if (kind === 'drone') {
      heading += turn * spec.turn * dt;
      forward.set(-Math.sin(heading), 0, -Math.cos(heading));
      vel.x += forward.x * fwd * spec.accel * dt;
      vel.z += forward.z * fwd * spec.accel * dt;
      vel.multiplyScalar(Math.exp(-(fwd ? 1.4 : 2.6) * dt));
      speed = Math.hypot(vel.x, vel.z);
      if (speed > spec.top) vel.multiplyScalar(spec.top / speed);
      vy = lerp(vy, up * 11, 1 - Math.exp(-5 * dt));
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      pos.y += vy * dt;
    } else {
      // Ground and water vehicles: they go where they point, and steer only while moving.
      spd += fwd * spec.accel * dt;
      spd *= Math.exp(-(fwd ? 0.35 : 1.5) * dt);
      spd = clamp(spd, -spec.top * 0.35, spec.top);
      heading += turn * spec.turn * dt * clamp(spd / 5, -1, 1);
      forward.set(-Math.sin(heading), 0, -Math.cos(heading));
      const nx = pos.x + forward.x * spd * dt;
      const nz = pos.z + forward.z * spd * dt;
      const h = heightAt(nx, nz);
      const fits = kind === 'boat' ? h < -0.6 : h > 0.3;
      if (fits && Math.hypot(nx, nz) < WORLD_R) {
        pos.x = nx;
        pos.z = nz;
      } else {
        spd *= -0.2;
        const back = touchFirst() ? 'Tap “Back to the drone”.' : 'Press E to take the drone.';
        warn(kind === 'boat' ? `The boat stays at sea. ${back}` : `The ${spec.name} stops at the shore. ${back}`);
      }
      vel.set(forward.x * spd, 0, forward.z * spd);
      vy = 0;
      speed = Math.abs(spd);
    }

    // Edge of the map: a soft wall.
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD_R) {
      pos.x *= WORLD_R / r;
      pos.z *= WORLD_R / r;
      vel.multiplyScalar(0.5);
      warn('Edge of the survey area: turn back to the island.');
    }

    // Buildings: slide around the solid parts.
    for (const s of sites) {
      for (const [sx, sz, sr, top] of s.solid) {
        if (kind === 'drone' && pos.y > top + 0.8) continue;
        const dx = pos.x - sx;
        const dz = pos.z - sz;
        const d = Math.hypot(dx, dz);
        const min = sr + (kind === 'drone' ? 1.2 : 0.9 * rigScale);
        if (d < min) {
          if (kind === 'drone' && pos.y > top - 1.2) pos.y = top + 0.8;
          else {
            const k = d > 0.01 ? min / d : 1;
            pos.x = sx + dx * k;
            pos.z = sz + dz * k;
            if (kind !== 'drone') spd *= 0.6;
          }
        }
      }
    }

    // Roofs: the drone flies under them or lands on top, and the walls of the entablature are solid.
    const roof = roofAt(pos.x, pos.z);
    if (kind === 'drone' && roof) {
      const wasUnder = underRoof(roof, prevX, prevZ);
      if (!wasUnder && pos.y > roof.ceiling - 1 && pos.y < roof.top + 0.8) {
        pos.x = prevX;
        pos.z = prevZ;
        vel.multiplyScalar(0.3);
      } else if (prevY >= roof.top - 0.3) {
        pos.y = Math.max(pos.y, roof.top + 0.8);
        vy = Math.max(vy, 0);
      } else if (pos.y > roof.ceiling - 1) {
        pos.y = roof.ceiling - 1;
        vy = Math.min(vy, 0);
      }
    }

    if (kind === 'drone') {
      const floor = Math.max(heightAt(pos.x, pos.z), 0.4) + MIN_CLEAR;
      if (pos.y < floor) {
        pos.y = floor;
        vy = Math.max(vy, 0);
      }
      if (pos.y > MAX_ALT) pos.y = MAX_ALT;

      // Drone pose: lean into the motion.
      const localFwd = (vel.x * forward.x + vel.z * forward.z) / spec.top;
      const localSide = (vel.x * Math.cos(heading) - vel.z * Math.sin(heading)) / spec.top;
      drone.group.position.copy(pos);
      drone.group.position.y += reduced ? 0 : Math.sin(time * 2.2) * 0.06;
      drone.group.rotation.set(-localFwd * 0.35, heading, -localSide * 0.35 - turn * 0.12);
      const spin = 26 + Math.abs(vy) * 2 + speed;
      drone.rotors.forEach((rotor, i) => (rotor.rotation.y += (i % 2 ? 1 : -1) * spin * dt));
    } else {
      // Follow the slope of the ground; the bike leans into turns, the boat rides the swell.
      const rig = rigs[kind];
      const share = clamp(spd / spec.top, -1, 1);
      if (kind === 'boat') {
        pos.y = 0;
        rig.position.set(pos.x, reduced ? 0 : Math.sin(time * 1.3) * 0.12, pos.z);
        rig.rotation.set(Math.sin(time * 0.9) * 0.04 - share * 0.08, heading + Math.PI, Math.sin(time * 0.7) * 0.05 - turn * share * 0.1);
      } else {
        pos.y = heightAt(pos.x, pos.z);
        const reach = 1.2 * rigScale;
        const ahead = heightAt(pos.x + forward.x * reach, pos.z + forward.z * reach);
        const behind = heightAt(pos.x - forward.x * reach, pos.z - forward.z * reach);
        rig.position.set(pos.x, pos.y + 0.06, pos.z);
        const lean = kind === 'bike' ? -turn * Math.abs(share) * 0.45 : turn * Math.abs(share) * 0.05;
        rig.rotation.set(-Math.atan2(ahead - behind, reach * 2), heading + Math.PI, lean);
      }
    }

    // Camera: follows behind, eases back after a drag.
    if (!pointers.size && (Math.abs(fwd) > 0.1 || autopilot)) camYaw = lerp(camYaw, 0, 1 - Math.exp(-1.5 * dt));
    const yaw = heading + camYaw;
    // Under a roof the camera comes closer and stays below the ceiling.
    const indoors = roof && pos.y < roof.ceiling ? roof : null;
    const dist = indoors ? Math.min(camDist, 8) : camDist;
    desired.set(pos.x + Math.sin(yaw) * Math.cos(camPitch) * dist, pos.y + Math.sin(camPitch) * dist + 1, pos.z + Math.cos(yaw) * Math.cos(camPitch) * dist);
    desired.y = Math.max(desired.y, Math.max(heightAt(desired.x, desired.z), 0) + 1.2);
    if (indoors) desired.y = Math.min(desired.y, indoors.ceiling - 0.6);
    if (first) {
      camPos.copy(desired);
      camLook.copy(pos);
      first = false;
    }
    camPos.lerp(desired, 1 - Math.exp(-6 * dt));
    camLook.lerp(pos, 1 - Math.exp(-10 * dt));
    camera.position.copy(camPos);
    camera.lookAt(camLook.x, camLook.y + 1, camLook.z);

    // The shadow camera follows the drone.
    sun.position.set(pos.x + 60, pos.y + 110, pos.z + 40);
    sun.target.position.set(pos.x, 0, pos.z);

    // Detection.
    const found = playing ? findTarget() : null;
    if (found !== target) {
      target = found;
      lockTime = 0;
      if (target) {
        promptTitle.textContent = target.def.title;
        promptSub.textContent = target.def.sub;
      }
    }
    prompt.hidden = !target || !!sheetOpen;
    if (target) {
      lockTime += dt;
      const confidence = Math.min(0.99, 0.55 + (lockTime / LOCK_SECONDS) * 0.44);
      placeBox(target, confidence);
      if (lockTime >= LOCK_SECONDS && !log.has(target.def.id)) {
        log.add(target.def.id);
        saveLog();
        target.beacon.visible = false;
        updateCount();
        if (touchFirst()) navigator.vibrate?.(35);
        const n = Number(countEl.textContent);
        toast(n >= total ? `All ${total} places logged. Thanks for flying.` : `Logged: ${target.def.title} · ${n} / ${total}`);
      }
    } else detect.hidden = true;

    hudTimer += dt;
    if (hudTimer > 0.2) {
      hudTimer = 0;
      altEl.textContent = String(Math.round(pos.y - Math.max(heightAt(pos.x, pos.z), 0)));
      spdEl.textContent = String(Math.round(Math.hypot(speed, vy)));
      const v = playing && !sheetOpen ? nearbyVehicle() : null;
      rideEl.hidden = !playing || !!sheetOpen || (!v && kind === 'drone');
      rideLabel.textContent = v ? `Take the ${SPEC[v.kind].name}` : 'Back to the drone';
    }
    mapTimer += dt;
    if (mapTimer > 1 / 20) {
      mapTimer = 0;
      drawMap();
    }
  }

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 1 / 10);
    last = now;
    time += dt;
    if (!document.hidden) tune(dt);
    step(dt);
    world.update(reduced ? time * 0.4 : time);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.body.classList.add('is-ready');

  // Deep link: /play/#<place> starts the flight toward it.
  const hash = decodeURIComponent(location.hash.slice(1));
  const linked = hash && sites.find((s) => s.def.id === hash);
  if (linked) {
    begin();
    flyTo(linked);
  }
}
