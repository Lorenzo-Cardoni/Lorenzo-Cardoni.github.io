// The game loop of /play: flight, camera, detection of places, the log of what has been found,
// and the HTML interface around the canvas (src/pages/play.astro).
import * as THREE from 'three';
import {
  BORDER,
  CAVE,
  CROWD,
  FOOT_R,
  GORGE,
  GUARD,
  ISLET_DOCK,
  RAMP,
  RIVER_CROSSING,
  WORLD_R,
  angDiff,
  clamp,
  coastRadius,
  isletShore,
  lerp,
  mainAt,
  mainRoad,
  polar,
  rad,
  roadAt,
  TAU,
  zoneOf,
  type Zone,
} from './layout';
import { PALETTE } from './palette';
import { makeDust } from './look';
import { lang, onLang, setLang, t } from './i18n';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeBike, makeBoat, makeCar, makeCharge, makeDrone, makeGhost, makeGuide, makePoof, makeRobot, type VehicleKind } from './models';
import { SUN_DIR, buildWorld, underRoof, type Roof, type Site } from './world';
import type { Gate, StationDef } from './stations';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

// Places are now known by opening them, in order: logs of earlier versions do not apply.
const STORE = 'island-log-2';
// The island changed shape: progress saved by earlier versions does not apply.
const PROGRESS = 'island-ghost-2';
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

/** A message at the top of the screen. `brief` ones (a place logged) are one small line. */
function toast(text: string, brief = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle('is-brief', brief);
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), brief ? 1800 : Math.min(6000, 2400 + text.length * 35));
}

/** Opens a place's page. `focus` moves the keyboard to it; pages that open by themselves leave it on the game. */
function openSheet(id: string, focus = true) {
  const article = $(`[data-entry="${CSS.escape(id)}"]`);
  if (!article) return;
  $$('[data-entry]').forEach((a) => (a.hidden = a !== article));
  sheet.hidden = false;
  sheet.scrollTop = 0;
  sheetOpen = id;
  onOpen(id);
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  if (focus) $('[data-close-sheet]')?.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheetOpen) return;
  sheet.classList.remove('is-open');
  sheet.hidden = true;
  sheetOpen = null;
  canvasFocus();
}

let canvasFocus = () => {};
/** Called when an entry opens: in the game, that is how a place gets known. */
let onOpen = (_id: string) => {};

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

/** Whether the visitor can travel to a zone from the places list; set once the game starts. */
let reachable = (_zone: string) => true;

function refreshPlaces() {
  $$('[data-place]').forEach((li) => {
    li.classList.toggle('is-done', log.has(li.dataset.place!));
    li.classList.toggle('is-locked', !reachable(li.dataset.zone ?? ''));
  });
}

// Theme: shared with the rest of the site. It changes the interface around the game; the island
// itself is always seen by day.
type ThemeName = 'dark' | 'light';
const themeName = (): ThemeName => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
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
  }),
);

// Language: English or Italian, for the game's own texts.
$$('[data-lang-toggle]').forEach((b) => b.addEventListener('click', () => setLang(lang === 'it' ? 'en' : 'it')));
onLang(() => $$('[data-lang-label]').forEach((el) => (el.textContent = lang === 'it' ? 'IT' : 'EN')));

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
    fullBtn.setAttribute('aria-label', full ? t('Leave full screen', 'Esci da schermo intero') : t('Full screen', 'Schermo intero'));
  });
}

// ---------- WebGL ----------

const data = JSON.parse($('#game-data')!.textContent || '{}') as { stations: StationDef[]; gates: Gate[] };
const total = data.stations.length;
const countEl = $('#hud-count')!;
/** The goal: visit every place. Ids of places that no longer exist do not count. */
const visited = () => [...log].filter((id) => data.stations.some((s) => s.id === id)).length;
const updateCount = () => {
  countEl.textContent = String(visited());
  refreshPlaces();
};
updateCount();

// The end: every place visited.
const finale = $<HTMLDialogElement>('#finale');
function finish() {
  if (!finale || finale.open) return;
  closeSheet();
  places.close();
  finale.showModal();
}
$$('[data-keep-exploring]').forEach((b) => b.addEventListener('click', () => finale?.close()));
$$('[data-start-over]').forEach((b) =>
  b.addEventListener('click', () => {
    try {
      localStorage.removeItem(STORE);
      localStorage.removeItem(PROGRESS);
    } catch {
      // ignore
    }
    location.hash = '';
    location.reload();
  }),
);

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
  // Sharp enough, and much cheaper than drawing every pixel of a high-density screen.
  let pixelRatio = Math.min(window.devicePixelRatio, touchFirst() ? 1.25 : 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The sun's shadows are drawn every other frame (see the loop), not every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Film-like tone: bright daylight that rolls off softly instead of clipping.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.tabIndex = 0;
  onLang(() => renderer.domElement.setAttribute('aria-label', t('Isola Vitae, in 3D. Use the places list to travel with the keyboard or a screen reader.', 'Isola Vitae, in 3D. Usa l’elenco dei luoghi per spostarti con la tastiera o con un lettore di schermo.')));
  stage.appendChild(renderer.domElement);
  canvasFocus = () => renderer.domElement.focus({ preventScroll: true });

  const world = buildWorld(data.stations, data.gates);
  const { scene, sun, sites, heightAt, litter } = world;
  if (touchFirst()) sun.shadow.mapSize.set(1024, 1024);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1600);

  // On a computer: soft shading where surfaces meet (ambient occlusion) and a light bloom on bright
  // things. On a phone the picture is drawn directly, which is much lighter.
  let composer: EffectComposer | null = null;
  if (!touchFirst()) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const ao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
      ao.blendIntensity = 0.7;
      // Fewer samples than the default: most of the softness for a fraction of the cost.
      ao.updateGtaoMaterial({ samples: 8 });
      ao.updatePdMaterial({ samples: 8 });
      composer.addPass(ao);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.9));
      composer.addPass(new OutputPass());
    } catch {
      composer = null;
    }
  }

  // ---------- The ghost and the machines ----------
  // The visitor is a ghost: it walks, cannot cross water and cannot fly. The goal is to visit every
  // place, and each zone of the island opens with a machine (see layout.ts): the e-bike climbs the
  // ramp to the plateau, the Bosch car jumps the river, the litter robot clears the gorge, the
  // GeoPosBall boat crosses to the islet. There the drone waits in its vault: visiting the data
  // science hall and the CNN teaches how to fix it, the Pieralisi motor charges it, and then it
  // flies to the mountain. GeoPosBall also switches the GPS on, which draws the minimap.

  const ghost = makeGhost();
  ghost.rotation.order = 'YXZ';
  // Almost see-through: only its eyes cast a shadow.
  ghost.traverse((o) => (o.castShadow = !((o as THREE.Mesh).material as THREE.Material | undefined)?.transparent));
  scene.add(ghost);
  const drone = makeDrone();
  drone.group.rotation.order = 'YXZ';
  drone.group.traverse((o) => (o.castShadow = true));
  drone.group.visible = false;
  scene.add(drone.group);
  const poof = makePoof();
  scene.add(poof);
  // Dust behind the wheels, spray behind the boat.
  const dust = makeDust();
  scene.add(dust.points);
  const DUST = new THREE.Color(PALETTE.road).lerp(new THREE.Color(0xffffff), 0.35);
  const SPRAY = new THREE.Color(0xffffff);
  let dustClock = 0;
  let poofAt = -10;

  // The start: on the road just before the first year gate, the university on one side and the
  // e-bike a little further on, facing along the timeline.
  const spawn = mainAt(0);
  const ahead = mainAt(8);
  const pos = new THREE.Vector3(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
  const vel = new THREE.Vector3();
  let heading = Math.atan2(-(ahead.x - spawn.x), -(ahead.z - spawn.z));
  let vy = 0;
  let camDist = 24;
  let camYaw = 0;
  let camPitch = 0.42;

  for (const s of sites) s.beacon.visible = !log.has(s.def.id);

  type Mode = 'ghost' | VehicleKind;
  /** `yaw`: for the machines that stay put, the way the view faces when the ghost possesses them. */
  type Machine = { kind: VehicleKind; object: THREE.Object3D; yaw: number; home: boolean; watch?: 'checkpoint' | 'court' };
  const SPEC: Record<Mode, { name: string; top: number; accel: number; turn: number; cam: number }> = {
    // `cam`: how far the view starts behind it, near the farthest the zoom allows.
    ghost: { name: 'ghost', top: 10, accel: 0, turn: 2.6, cam: 24 },
    drone: { name: 'drone', top: 28, accel: 38, turn: 1.9, cam: 34 },
    car: { name: 'car', top: 30, accel: 20, turn: 1.7, cam: 19 },
    bike: { name: 'e-bike', top: 17, accel: 14, turn: 2.1, cam: 16 },
    boat: { name: 'boat', top: 20, accel: 9, turn: 1.0, cam: 20 },
    robot: { name: 'litter robot', top: 9, accel: 10, turn: 2.2, cam: 15 },
    motor: { name: 'motor', top: 0, accel: 0, turn: 0, cam: 18 },
    camera: { name: 'security camera', top: 0, accel: 0, turn: 0.9, cam: 0 },
  };
  /** The machines the ghost can turn into at any time, once it has possessed them. */
  const FORMS: VehicleKind[] = ['bike', 'car', 'robot', 'boat', 'drone'];
  /** A machine with its article, as in "you possessed the e-bike". */
  const WHERE: Record<VehicleKind, () => string> = {
    bike: () => t('the e-bike', 'l’e-bike'),
    car: () => t('the Bosch car', 'l’auto della Bosch'),
    robot: () => t('the litter robot', 'il robot spazzino'),
    boat: () => t('the GeoPosBall boat', 'la barca di GeoPosBall'),
    motor: () => t('the Pieralisi motor', 'il motore della Pieralisi'),
    drone: () => t('the drone in its vault', 'il drone nel suo caveau'),
    camera: () => t('the security camera', 'la telecamera di sicurezza'),
  };
  /** The short name with its article: "the car", "l'auto". */
  const THE: Record<Mode, () => string> = {
    ghost: () => t('the ghost', 'il fantasma'),
    drone: () => t('the drone', 'il drone'),
    car: () => t('the car', 'l’auto'),
    bike: () => t('the e-bike', 'l’e-bike'),
    boat: () => t('the boat', 'la barca'),
    robot: () => t('the litter robot', 'il robot spazzino'),
    motor: () => t('the motor', 'il motore'),
    camera: () => t('the security camera', 'la telecamera'),
  };
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const USE: Record<VehicleKind, () => string> = {
    bike: () => t('It is the only way up the ramp to the plateau.', 'È l’unico modo per salire la rampa fino all’altopiano.'),
    car: () => t('At full speed it can jump the river.', 'A tutta velocità può saltare il fiume.'),
    robot: () => t('Drive it into the litter to clear the gorge.', 'Guidalo contro la spazzatura per liberare la gola.'),
    boat: () => t('The islet lies east, past the cliffs of the mountain.', 'L’isolotto è a est, oltre le scogliere della montagna.'),
    motor: () => '',
    drone: () => '',
    camera: () => t('Turn the camera until what you are looking for glows, and hold it in view to identify it.', 'Ruota la telecamera finché ciò che cerchi si illumina, e tienilo inquadrato per identificarlo.'),
  };
  const ZONE_HINT: Partial<Record<Zone, () => string>> = {
    plateau: () => t('The plateau. The Bosch car here is fast enough to jump the river ahead.', 'L’altopiano. L’auto della Bosch è abbastanza veloce da saltare il fiume più avanti.'),
    valley: () => t('Across the river!', 'Oltre il fiume!'),
    yard: () => t('Past the checkpoint. Litter blocks the gorge: the litter robot can clear it.', 'Oltre il posto di blocco. La spazzatura chiude la gola: il robot spazzino può liberarla.'),
    harbour: () => t('The harbour. GeoPosBall switches the GPS on, and its boat crosses to the islet.', 'Il porto. GeoPosBall accende il GPS, e la sua barca porta all’isolotto.'),
    islet: () => t('The islet and the drone vault. Learn from the projects on the plaza to fix the drone, and charge it with the Pieralisi motor.', 'L’isolotto e il caveau del drone. Impara dai progetti della piazza per aggiustarlo, e caricalo con il motore della Pieralisi.'),
    mountain: () => t('The mountain: Lega del Filo d’Oro, the volleyball court, Inim, the profile among the skills, and the lighthouse on the cape.', 'La montagna: Lega del Filo d’Oro, il campo da pallavolo, Inim, il profilo tra le skill e il faro sul capo.'),
  };
  const rigs: Partial<Record<VehicleKind, THREE.Object3D>> = { drone: drone.group, car: makeCar(), bike: makeBike(), boat: makeBoat(), robot: makeRobot() };
  for (const k of ['car', 'bike', 'boat', 'robot'] as const) {
    const rig = rigs[k]!;
    rig.rotation.order = 'YXZ';
    rig.visible = false;
    rig.traverse((o) => (o.castShadow = true));
    scene.add(rig);
  }
  const vp0 = new THREE.Vector3();
  // `home`: still in its place on the island. Once possessed, a machine stays where it is left.
  const machines: Machine[] = sites.flatMap((site) => (site.built.vehicles ?? []).map((v) => ({ ...v, yaw: site.def.yaw, home: true })));
  // The security cameras, first pointed a little away from what they watch: the checkpoint in the
  // valley, the volleyball court on the mountain. The head's lens looks along its +z, the view along
  // -z of the heading: half a turn apart.
  for (const cam of world.cameras) {
    cam.head.getWorldPosition(vp0);
    const tx = cam.watch === 'court' ? world.court!.x : GUARD.x;
    const tz = cam.watch === 'court' ? world.court!.z : GUARD.z;
    const look = Math.atan2(-(tx - vp0.x), -(tz - vp0.z)) + 1.2;
    cam.head.rotation.y = look + Math.PI;
    machines.push({ kind: 'camera', object: cam.head, yaw: look, home: true, watch: cam.watch });
  }

  // Progress, kept between visits.
  const progress = { met: new Set<VehicleKind>(), zones: new Set<Zone>(['start']), charged: false, flight: false, gps: false, litter: false, identified: false, referee: false, metCrowd: false, metGuard: false, explosives: false, lfoDone: false, inimDone: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS) || '{}');
    for (const k of saved.met ?? []) if (k in WHERE) progress.met.add(k);
    for (const z of saved.zones ?? []) progress.zones.add(z);
    progress.charged = !!saved.charged;
    progress.flight = !!saved.flight;
    progress.gps = !!saved.gps;
    progress.litter = !!saved.litter;
    progress.identified = !!saved.identified;
    progress.referee = !!saved.referee;
    progress.metCrowd = !!saved.metCrowd;
    progress.metGuard = !!saved.metGuard;
    progress.explosives = !!saved.explosives;
    progress.lfoDone = !!saved.lfoDone;
    progress.inimDone = !!saved.inimDone;
  } catch {
    // Storage unavailable: progress lasts for this visit.
  }
  const saveProgress = () => {
    try {
      localStorage.setItem(PROGRESS, JSON.stringify({ ...progress, met: [...progress.met], zones: [...progress.zones] }));
    } catch {
      // ignore
    }
  };
  reachable = (z) => progress.flight || progress.zones.has(z as Zone);

  // ---------- Knowledge ----------
  // A place is known once the visitor gets close to it, in any order. A few places are also the
  // answer to an obstacle: the 2023 hackathon to the tourists, super-resolution to the blurry
  // camera, the CNN and the data science projects to the broken drone.

  const gpsSite = sites.find((s) => s.def.model === 'buoys');
  const crowdSite = sites.find((s) => s.def.model === 'tent' && s.def.zone === 'plateau');
  const superRes = sites.find((s) => s.def.model === 'pixelwall');
  const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')}${t(' and ', ' e ')}${items[items.length - 1]}` : items[0] ?? '');
  /** The places that teach how to fix the drone: the CNN and the data science projects on the plaza. */
  const lessons = sites.filter((s) => s.def.zone === 'islet' && s.def.model.startsWith('exhibit'));
  /** What is still missing before the drone flies, in words; empty when it is ready. */
  const droneNeeds = () => [
    ...(lessons.some((s) => !log.has(s.def.id))
      ? [t(`learn from the projects on the plaza (${lessons.filter((s) => !log.has(s.def.id)).length} to go)`, `impara dai progetti della piazza (ne mancano ${lessons.filter((s) => !log.has(s.def.id)).length})`)]
      : []),
    ...(progress.charged ? [] : [t('charge it with the Pieralisi motor', 'caricalo con il motore della Pieralisi')]),
  ];

  // Litter already cleared on an earlier visit.
  if (progress.litter) for (const pile of litter) pile.object.visible = false;

  // The tourists move aside once the hackathon is known; the armed man is taken away once identified.
  let crowdAt = crowdSite && log.has(crowdSite.def.id) ? -100 : Infinity;
  const CROWD_GAP = 0.45;
  const CROWD_WALK = 4.5;
  let guardAt = progress.identified ? -10 : Infinity;
  let shotAt = -10;
  // The volleyball player leaves the court once identified; until then he spikes the ball.
  let courtAt = progress.referee ? -10 : Infinity;
  let spikeAt = -10;
  const spikeFrom = new THREE.Vector3();
  const spikeTo = new THREE.Vector3();
  let idTime = 0;

  let mode: Mode = 'ghost';
  let taken: Machine | null = null;
  let spd = 0;
  let rigScale = 1;
  let rpm = 0;
  let charge = progress.charged ? 1 : 0;
  let warnedAt = -10;
  const vp = new THREE.Vector3();
  const vd = new THREE.Vector3();
  document.body.dataset.vehicle = mode;

  function warn(text: string) {
    if (time - warnedAt < 3) return;
    warnedAt = time;
    toast(text);
  }

  const leaveKey = () => (touchFirst() ? t('Tap “Leave”', 'Tocca “Lascia”') : t('Press E', 'Premi E'));

  function machineAt(m: Machine, out: THREE.Vector3) {
    return m.home ? m.object.getWorldPosition(out) : out.copy(rigs[m.kind]!.position);
  }

  type ZoneTest = (zone: Zone) => boolean;
  const anyLand: ZoneTest = (z) => z !== 'sea';

  /** Land the ghost can stand on: inside the map, above the sea, clear of buildings, in an allowed zone. */
  function standable(x: number, z: number, ok: ZoneTest = anyLand) {
    if (Math.hypot(x, z) > WORLD_R - 2 || heightAt(x, z) < 0.3 || !ok(zoneOf(x, z))) return false;
    return !sites.some((s) => s.solid.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr + 0.9));
  }

  /** The nearest spot the ghost can stand on, searching outward from a point; null if none is close. */
  function landNear(x: number, z: number, reach = 30, ok: ZoneTest = anyLand): { x: number; z: number } | null {
    if (standable(x, z, ok)) return { x, z };
    for (let d = 2; d <= reach; d += 2) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        if (standable(x + Math.cos(a) * d, z + Math.sin(a) * d, ok)) return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
      }
    }
    return null;
  }

  // ---------- Zones and obstacles ----------

  /** The zone the visitor is in, updated every frame. */
  let here: Zone = zoneOf(pos.x, pos.z);
  /** The car in the air over the river: time since take-off and height at take-off. */
  let jump: { t: number; y0: number } | null = null;
  const JUMP_SPEED = 21;
  const JUMP_TIME = 1.15;
  const nearRiver = (x: number, z: number) => Math.hypot(x - RIVER_CROSSING.x, z - RIVER_CROSSING.z) < 26;

  /** Why a move on the ground from one zone to another is not allowed, or null when it is. */
  function blocked(from: Zone, to: Zone, x: number, z: number): string | null {
    if (from === to || from === 'sea' || to === 'sea') return null;
    const pair = (a: Zone, b: Zone) => (from === a && to === b) || (from === b && to === a);
    if (to === 'mountain') return mode === 'ghost' ? t('Sheer cliffs: only something that flies gets up there.', 'Scogliere a picco: lassù arriva solo qualcosa che vola.') : t('Sheer cliffs: only the drone gets up there.', 'Scogliere a picco: lassù arriva solo il drone.');
    // Down from the mountain is always allowed: only the drone gets up there in the first place.
    if (from === 'mountain') return null;
    if (pair('start', 'plateau')) {
      if (Math.hypot(x - RAMP.x, z - RAMP.z) > 12) return t('A sheer step: the way up is the ramp on the road.', 'Un gradino a picco: si sale dalla rampa sulla strada.');
      if (from === 'plateau') return null;
      if (mode !== 'bike' && mode !== 'car') {
        return mode === 'ghost' ? t('Too steep for a ghost. The e-bike could climb this ramp.', 'Troppo ripida per un fantasma. L’e-bike potrebbe salire questa rampa.') : t(`Too steep for ${THE[mode]()}.`, `Troppo ripida per ${THE[mode]()}.`);
      }
      return null;
    }
    if (pair('valley', 'yard')) {
      if (from === 'yard') return null;
      return progress.identified ? null : t('The armed man at the checkpoint will not let anyone through.', 'L’uomo armato al posto di blocco non lascia passare nessuno.');
    }
    if (pair('yard', 'harbour')) {
      if (Math.hypot(x - GORGE.x, z - GORGE.z) > 15) return t('The ridge is too steep. The road goes through the gorge.', 'La cresta è troppo ripida. La strada passa per la gola.');
      // Only litter right there blocks the way: the robot can move along the gorge clearing it.
      if (litter.some((pile) => pile.object.visible && Math.hypot(pile.x - x, pile.z - z) < pile.r + 3.5)) {
        return t('Litter blocks the gorge. The litter robot can clear it.', 'La spazzatura chiude la gola. Il robot spazzino può liberarla.');
      }
      return null;
    }
    return t('No way through here.', 'Di qui non si passa.');
  }

  /** Why a machine on the ground stops at the water's edge. */
  function shoreReason(): string {
    if (mode === 'boat') return t('The boat stays at sea.', 'La barca resta in mare.');
    if (nearRiver(pos.x, pos.z)) {
      if (mode === 'car') return t('Too slow to jump: take a run-up, the car clears the river at full speed.', 'Troppo lenta per saltare: prendi la rincorsa, l’auto supera il fiume a tutta velocità.');
      return mode === 'ghost'
        ? t('Ghosts cannot swim. The Bosch car can jump the river.', 'I fantasmi non sanno nuotare. L’auto della Bosch può saltare il fiume.')
        : t(`${cap(THE[mode]())} cannot cross the river. The Bosch car can jump it.`, `${cap(THE[mode]())} non può attraversare il fiume. L’auto della Bosch può saltarlo.`);
    }
    if (mode === 'ghost') return here === 'harbour' && !progress.met.has('boat') ? t('Ghosts cannot swim. The GeoPosBall boat can cross the sea.', 'I fantasmi non sanno nuotare. La barca di GeoPosBall può attraversare il mare.') : t('Ghosts cannot swim.', 'I fantasmi non sanno nuotare.');
    return t(`${cap(THE[mode]())} stops at the shore. ${leaveKey()} to get out.`, `${cap(THE[mode]())} si ferma alla riva. ${leaveKey()} per uscire.`);
  }

  /** First steps into a zone: the visitor can now travel there from the places list. */
  function enterZone(zone: Zone) {
    if (zone === 'sea' || progress.zones.has(zone)) return;
    progress.zones.add(zone);
    saveProgress();
    refreshPlaces();
    if (ZONE_HINT[zone]) toast(ZONE_HINT[zone]!());
  }

  function puff(at: THREE.Vector3) {
    poof.position.set(at.x, Math.max(at.y, 0) + 0.15, at.z);
    poofAt = time;
    poof.visible = true;
  }

  function setMode(next: Mode) {
    mode = next;
    ghost.visible = mode === 'ghost';
    for (const m of machines) {
      const rig = rigs[m.kind];
      if (rig) rig.visible = !m.home;
      if (m.kind !== 'motor') m.object.visible = m.home;
    }
    camDist = mode === 'ghost' || mode === 'drone' || mode === 'motor' || mode === 'camera' ? SPEC[mode].cam : SPEC[mode].cam * rigScale;
    // Seen from inside, the camera's own head would fill the picture.
    for (const cam of world.cameras) cam.head.visible = !(mode === 'camera' && taken?.object === cam.head);
    document.body.dataset.vehicle = mode;
  }

  /** Why the ghost cannot possess a machine yet, or null. */
  function refusal(m: Machine): string | null {
    if (m.kind === 'drone' && droneNeeds().length) return t(`The drone will not fly yet. To fix it, ${listOf(droneNeeds())}.`, `Il drone non vola ancora. Per aggiustarlo, ${listOf(droneNeeds())}.`);
    if (m.kind === 'camera' && m.watch === 'checkpoint' && superRes && !log.has(superRes.def.id)) {
      return t('The camera feed is too blurry to recognise anyone. Get to know the super-resolution project first.', 'L’immagine della telecamera è troppo sfocata per riconoscere qualcuno. Prima conosci il progetto di super-resolution.');
    }
    return null;
  }

  function possess(m: Machine) {
    const no = refusal(m);
    if (no) {
      toast(no);
      return;
    }
    puff(ghost.position);
    const rig = rigs[m.kind];
    if (m.kind === 'motor' || m.kind === 'camera' || !rig) {
      m.object.getWorldPosition(pos);
      // The motor: the view looks at the bench from the front of the factory. The camera: the
      // view is the camera's own.
      heading = m.kind === 'camera' ? m.object.rotation.y - Math.PI : m.yaw;
      rigScale = 1;
      idTime = 0;
    } else if (m.home) {
      m.object.getWorldScale(vd);
      // The drone keeps the size it always flew at; the others match the one parked on the island.
      rigScale = m.kind === 'drone' ? 1 : vd.x;
      rig.scale.setScalar(rigScale);
      m.object.getWorldPosition(vp);
      vd.set(0, 0, 1).transformDirection(m.object.matrixWorld);
      heading = Math.atan2(-vd.x, -vd.z);
      pos.set(vp.x, m.kind === 'boat' ? 0 : m.kind === 'drone' ? vp.y : heightAt(vp.x, vp.z), vp.z);
      m.home = false;
    } else {
      rigScale = rig.scale.x;
      heading = m.kind === 'drone' ? rig.rotation.y : rig.rotation.y - Math.PI;
      pos.copy(rig.position);
      if (m.kind !== 'drone') pos.y = m.kind === 'boat' ? 0 : heightAt(pos.x, pos.z);
    }
    taken = m;
    autopilot = null;
    spd = 0;
    rpm = 0;
    vel.set(0, 0, 0);
    vy = 0;
    setMode(m.kind);

    const firstEver = !progress.met.size;
    const first = !progress.met.has(m.kind);
    progress.met.add(m.kind);
    if (m.kind === 'drone' && !progress.flight) {
      progress.flight = true;
      const climb = touchFirst() ? t('The arrows climb and descend.', 'Le frecce salgono e scendono.') : t('Space and Shift climb and descend.', 'Spazio e Shift salgono e scendono.');
      toast(t(`Flight unlocked! ${climb} From now on you can turn into the drone anywhere.`, `Volo sbloccato! ${climb} D’ora in poi puoi trasformarti nel drone ovunque.`));
    } else if (m.kind === 'motor' && !progress.charged) toast(t(`Hold forward to spin the motor up and charge the drone. ${leaveKey()} to leave.`, `Tieni premuto avanti per far girare il motore e caricare il drone. ${leaveKey()} per uscire.`));
    else if (firstEver) {
      const shapes = touchFirst() ? t('the shapes button', 'il pulsante delle forme') : 'Q';
      toast(t(`You possessed ${WHERE[m.kind]()}! A ghost can enter any machine, and turn into it again at any time (${shapes}). ${USE[m.kind]()}`, `Hai posseduto ${WHERE[m.kind]()}! Un fantasma può entrare in qualsiasi macchina, e ritrasformarsi in essa quando vuole (${shapes}). ${USE[m.kind]()}`));
    } else if (first) toast(t(`You possessed ${WHERE[m.kind]()}. ${USE[m.kind]()}`, `Hai posseduto ${WHERE[m.kind]()}. ${USE[m.kind]()}`));
    else if (m.kind === 'camera') toast(USE.camera());
    saveProgress();
    refreshForms();
  }

  /** Ends a possession: the machine stays where it is (the drone lands). */
  function release() {
    const m = taken;
    if (!m) return;
    if (m.kind === 'motor') m.object.userData.boost = 0;
    else if (m.kind === 'camera') m.object.rotation.y = heading + Math.PI;
    else if (m.kind === 'drone') {
      drone.group.position.set(pos.x, Math.max(heightAt(pos.x, pos.z), 0) + 0.6, pos.z);
      drone.group.rotation.set(0, heading, 0);
    }
    taken = null;
    rpm = 0;
    jump = null;
  }

  /** The ghost comes out next to the machine, on solid ground. */
  function leave() {
    if (!taken) return;
    const out = taken.kind === 'motor' ? 3 : taken.kind === 'camera' ? 0 : 2.4 * rigScale;
    // Out to the right of a vehicle; in front of the bench for the motor.
    const cx = taken.kind === 'motor' ? pos.x + Math.sin(heading) * out : pos.x + Math.cos(heading) * out;
    const cz = taken.kind === 'motor' ? pos.z + Math.cos(heading) * out : pos.z - Math.sin(heading) * out;
    const zone = here;
    const ok: ZoneTest = taken.kind === 'drone' ? anyLand : taken.kind === 'boat' ? (z) => z !== 'sea' && z !== 'mountain' : (z) => z === zone;
    const spot = landNear(cx, cz, taken.kind === 'boat' ? 40 : 24, ok);
    if (!spot) {
      warn(taken.kind === 'boat' ? t('Steer closer to the shore first: ghosts cannot swim.', 'Avvicinati prima alla riva: i fantasmi non sanno nuotare.') : t('Fly over the island first: ghosts cannot swim.', 'Prima vola sopra l’isola: i fantasmi non sanno nuotare.'));
      return;
    }
    release();
    pos.set(spot.x, heightAt(spot.x, spot.z), spot.z);
    vel.set(0, 0, 0);
    spd = 0;
    vy = 0;
    setMode('ghost');
    puff(pos);
  }

  /** A spot of open sea near a point, for the boat. */
  function waterNear(x: number, z: number, reach: number): { x: number; z: number } | null {
    for (let d = 0; d <= reach; d += 2) {
      for (let i = 0; i < (d ? 16 : 1); i++) {
        const a = (i / 16) * TAU;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (heightAt(px, pz) < -0.9 && Math.hypot(px, pz) < WORLD_R - 4) return { x: px, z: pz };
      }
    }
    return null;
  }

  /**
   * Turns the ghost (or the machine it is in) into a machine it has possessed before: the machine
   * comes to it, wherever it was left. Land machines appear on the ground of the same zone, the boat
   * on the water nearby, the drone just above.
   */
  function becomeMachine(kind: VehicleKind) {
    const m = machines.find((x) => x.kind === kind);
    if (!m || !progress.met.has(kind) || kind === mode) return;
    const no = refusal(m);
    if (no) {
      toast(no);
      return;
    }
    const rig = rigs[kind]!;
    let spot: { x: number; z: number } | null;
    if (kind === 'drone') spot = { x: pos.x, z: pos.z };
    else if (kind === 'boat') spot = waterNear(pos.x, pos.z, 30);
    else {
      const zone = here;
      spot = landNear(pos.x, pos.z, 24, zone === 'sea' ? (z) => z !== 'sea' && z !== 'mountain' : (z) => z === zone);
    }
    if (!spot) {
      toast(kind === 'boat' ? t('No water close enough for the boat.', 'Non c’è acqua abbastanza vicina per la barca.') : t(`No ground close enough for ${THE[kind]()}.`, `Non c’è terreno abbastanza vicino per ${THE[kind]()}.`));
      return;
    }
    if (m.home) {
      m.object.getWorldScale(vd);
      rig.scale.setScalar(kind === 'drone' ? 1 : vd.x);
      m.home = false;
    }
    release();
    const ground = Math.max(heightAt(spot.x, spot.z), 0);
    rig.position.set(spot.x, kind === 'drone' ? Math.max(pos.y, ground + 2.2) : kind === 'boat' ? 0 : ground, spot.z);
    rig.rotation.set(0, kind === 'drone' ? heading : heading + Math.PI, 0);
    possess(m);
  }

  // The shapes menu: the ghost, and every machine possessed so far.
  const forms = $<HTMLDialogElement>('#forms');
  const formsBtn = $('[data-open-forms]');
  function refreshForms() {
    const any = FORMS.some((k) => progress.met.has(k));
    if (formsBtn) formsBtn.hidden = !any;
    $$('[data-form]').forEach((b) => {
      const kind = b.dataset.form as Mode;
      b.hidden = kind !== 'ghost' && !progress.met.has(kind as VehicleKind);
      b.classList.toggle('is-current', kind === mode);
    });
  }
  function openForms() {
    if (!forms || !FORMS.some((k) => progress.met.has(k))) return;
    refreshForms();
    forms.showModal();
    ($(`[data-form="${mode}"]`) ?? $('[data-form="ghost"]'))?.focus();
  }
  // Arrows (or WASD) move between the shapes, three to a row; Enter picks one; Q closes.
  forms?.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'q') {
      forms.close();
      return;
    }
    const cols = window.matchMedia('(max-width: 420px)').matches ? 2 : 3;
    const step = ({ ArrowRight: 1, d: 1, ArrowLeft: -1, a: -1, ArrowDown: cols, s: cols, ArrowUp: -cols, w: -cols } as Record<string, number>)[k];
    if (step === undefined) return;
    e.preventDefault();
    const buttons = $$('[data-form]').filter((b) => !b.hidden);
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[i < 0 ? 0 : (i + step + buttons.length) % buttons.length]?.focus();
  });
  $$('[data-open-forms]').forEach((b) => b.addEventListener('click', openForms));
  forms?.addEventListener('click', (e) => {
    if (e.target === forms) forms.close();
  });
  $$('[data-form]').forEach((b) =>
    b.addEventListener('click', () => {
      forms?.close();
      const kind = b.dataset.form as Mode;
      if (kind === 'ghost') leave();
      else becomeMachine(kind);
    }),
  );
  refreshForms();

  function nearbyMachine(): Machine | null {
    if (mode !== 'ghost') return null;
    let best: Machine | null = null;
    let bestD = Infinity;
    for (const m of machines) {
      machineAt(m, vp);
      const d = Math.hypot(vp.x - pos.x, vp.z - pos.z);
      // The boat is reached from the shore; the others from the same zone, not across an obstacle.
      if (m.kind !== 'boat' && d < 9 && zoneOf(vp.x, vp.z) !== here) continue;
      if (d < (m.kind === 'boat' ? 15 : 9) && d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  function swap() {
    if (mode !== 'ghost') return leave();
    const m = nearbyMachine();
    if (m) possess(m);
    else {
      const shapes = touchFirst() ? t('The shapes button', 'Il pulsante delle forme') : 'Q';
      warn(FORMS.some((k) => progress.met.has(k)) ? t(`Nothing to possess here. ${shapes} turns you into a machine you have possessed.`, `Qui non c’è niente da possedere. ${shapes} ti trasforma in una macchina già posseduta.`) : t('Nothing to possess here.', 'Qui non c’è niente da possedere.'));
    }
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
    if (!playing || places.open || finale?.open || forms?.open) return;
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
    if (k === 'q') {
      if (!e.repeat) openForms();
      return;
    }
    if (k === 'x') {
      if (!e.repeat) dropCharge();
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
      camDist = clamp(camDist * (pinch / Math.max(d, 1)), 6, 46);
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
      camDist = clamp(camDist * Math.exp(e.deltaY * 0.001), 6, 46);
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

  /**
   * Travel from the places list. Before flight is unlocked the ghost vanishes and reappears in front
   * of the place; after, the drone comes and the autopilot flies there.
   */
  function go(site: Site) {
    places.close();
    closeSheet();
    if (!playing) begin();
    if (shielded(site)) {
      toast(t('The AI engineer platform is behind a force field: secure Inim Electronics first.', 'La piattaforma dell’AI engineer è dietro un campo di forza: prima metti in sicurezza Inim Electronics.'));
      return;
    }
    if (!reachable(site.def.zone)) {
      toast(t('You have not reached that part of the island yet. Find the way there first.', 'Non hai ancora raggiunto quella parte dell’isola. Prima trova la strada.'));
      return;
    }
    if (progress.flight) {
      if (mode !== 'drone') becomeMachine('drone');
      flyTo(site);
      toast(t(`Flying to ${site.def.title}`, `In volo verso ${site.def.title}`), true);
      return;
    }
    release();
    const spot = spotNear(site);
    pos.set(spot.x, heightAt(spot.x, spot.z), spot.z);
    here = zoneOf(pos.x, pos.z);
    heading = Math.atan2(-(site.def.x - spot.x), -(site.def.z - spot.z));
    vel.set(0, 0, 0);
    spd = 0;
    camYaw = 0;
    first = true;
    setMode('ghost');
    puff(pos);
    openSheet(site.def.id);
  }

  /** Where the ghost reappears: in front of a place, or in the aisle beside an exhibit. */
  function spotNear(site: Site): { x: number; z: number } {
    const d = site.def;
    const host = d.inside ? sites.find((h) => h.def.id === d.inside) : undefined;
    const same: ZoneTest = (z) => z === d.zone;
    if (host) {
      // In the aisle, halfway between the exhibit and the middle of the hall.
      const x = (d.x + host.def.x + (d.x - host.def.x) * 0.1) / 2;
      const z = (d.z + host.def.z + (d.z - host.def.z) * 0.1) / 2;
      return landNear(x, z, 6) ?? { x, z };
    }
    if (d.sea) return landNear(d.x, d.z, 60, same) ?? { x: pos.x, z: pos.z };
    return landNear(d.x + Math.sin(d.yaw) * (d.r + 2), d.z + Math.cos(d.yaw) * (d.r + 2), 30, same) ?? { x: pos.x, z: pos.z };
  }

  $$('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      const site = sites.find((s) => s.def.id === b.dataset.goto);
      if (site) go(site);
      else places.close();
    }),
  );
  // ---------- Start ----------

  function begin() {
    playing = true;
    intro.hidden = true;
    document.body.classList.add('is-playing');
    canvasFocus();
    const done = visited();
    if (done >= total) return;
    if (!done && !progress.met.size) {
      toast(t(`Goal: get to know all ${total} places. Walk up to one to know it. The line at the top and the orange arrow always show what to do next.`, `Obiettivo: conoscere tutti i ${total} luoghi. Avvicinati a uno per conoscerlo. La riga in alto e la freccia arancione mostrano sempre cosa fare.`));
    } else toast(t(`Welcome back: ${done} of ${total} places known.`, `Bentornato: ${done} luoghi conosciuti su ${total}.`));
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
  const statsEl = $('#hud-stats')!;
  const rideEl = $('#ride')!;
  const rideLabel = $('#ride-label')!;
  let target: Site | null = null;
  let lockTime = 0;
  // The card of the place in view: small, so the machine buttons stay in sight. "More" opens the page.
  const card = $('#card')!;
  /** The place the detector last locked on, so getting to know it is tried once per visit. */
  let tried: string | null = null;
  const cardKicker = $('#card-kicker')!;
  const cardTitle = $('#card-title')!;
  const cardSub = $('#card-sub')!;
  $$('[data-open-entry]').forEach((b) => b.addEventListener('click', () => target && openSheet(target.def.id)));
  function showCard(site: Site) {
    const known = log.has(site.def.id);
    cardKicker.textContent = known ? `${site.def.tag} · ${t('known', 'conosciuto')} ✓` : site.def.tag;
    cardKicker.classList.toggle('is-known', known);
    cardTitle.textContent = site.def.title;
    cardSub.textContent = site.def.sub;
    card.hidden = false;
  }

  /** Opening an entry gets the place known, with what that unlocks. */
  onOpen = (id) => {
    const site = sites.find((s) => s.def.id === id);
    if (!site || log.has(id) || !playing) return;
    log.add(id);
    saveLog();
    site.beacon.visible = false;
    updateCount();
    if (touchFirst()) navigator.vibrate?.(35);
    const n = visited();
    if (n >= total) {
      window.setTimeout(finish, 600);
      return;
    }
    if (site === gpsSite && !progress.gps) {
      progress.gps = true;
      saveProgress();
      toast(t('GPS online: the minimap now shows the whole island.', 'GPS attivo: ora la minimappa mostra tutta l’isola.'));
    } else if (site === crowdSite) {
      crowdAt = time;
      toast(t('Now you know the event: the tourists slowly make way, and the road to the river will be clear.', 'Ora conosci l’evento: i turisti si spostano piano piano, e la strada verso il fiume si libererà.'));
    } else if (site === superRes && !progress.identified) {
      toast(t('Now you can sharpen a far, small detail. Possess the security camera by the road and look at the crowd at the checkpoint.', 'Ora sai rendere nitido un dettaglio piccolo e lontano. Possiedi la telecamera a bordo strada e guarda la gente al posto di blocco.'));
    } else if (site.def.zone === 'islet' && !progress.flight) {
      const needs = droneNeeds();
      toast(needs.length ? t(`✓ ${site.def.title}. For the drone, still: ${listOf(needs)}.`, `✓ ${site.def.title}. Per il drone manca ancora: ${listOf(needs)}.`) : t('You know how to fix the drone now, and it is charged. It waits in the vault.', 'Ora sai come aggiustare il drone, ed è carico. Ti aspetta nel caveau.'));
    } else toast(`✓ ${site.def.title} · ${n}/${total}`, true);
  };

  function findTarget(): Site | null {
    let best: Site | null = null;
    let bestScore = Infinity;
    for (const s of sites) {
      const dx = s.def.x - pos.x;
      const dz = s.def.z - pos.z;
      const d = Math.hypot(dx, dz);
      const reach = s.def.r + 13;
      if (d > reach || pos.y - s.y > 45 || shielded(s)) continue;
      // On the ground a place is seen from its own zone, not across a river or up a cliff.
      if (mode !== 'drone' && s.def.zone !== here && !(s.def.sea && here === 'sea')) continue;
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
  /** Where the screen is free of text at the top: below the bar, the objective and any message. */
  let safeTop = 30;
  const topBar = $('.hud.top');
  function measureTop() {
    let bottom = topBar?.getBoundingClientRect().bottom ?? 0;
    const objective = $('#objective');
    if (objective && !objective.hidden) bottom = Math.max(bottom, objective.getBoundingClientRect().bottom);
    if (toastEl.classList.contains('is-on') && toastEl.textContent) bottom = Math.max(bottom, toastEl.getBoundingClientRect().bottom);
    // Room for the label, which sits above the box.
    safeTop = bottom + 34;
  }
  function placeBox(b: THREE.Box3, label: string, locked: boolean) {
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
    // The label sits above the box: keep both below the lines of text at the top of the screen.
    const top = clamp(((1 - maxY) / 2) * h, safeTop, h - 8);
    const bottom = clamp(((1 - minY) / 2) * h, safeTop, h - 8);
    // Too small to read, or so close that the box would frame the whole screen.
    if (right - left < 20 || bottom - top < 20 || (right - left > w * 0.8 && bottom - top > h * 0.7)) {
      detect.hidden = true;
      return;
    }
    detect.hidden = false;
    detect.style.transform = `translate(${left}px, ${top}px)`;
    detect.style.width = `${right - left}px`;
    detect.style.height = `${bottom - top}px`;
    detect.classList.toggle('is-locked', locked);
    detectLabel.textContent = label;
  }

  // ---------- The secret: explosives ----------
  // A cave at the foot of the mountain, in the start zone, hides a crate of explosives. Once found,
  // X (or the bomb button) drops a charge that goes off a moment later and blows the island apart
  // around it. Nothing of it is saved: the island is whole again on the next visit.

  /** A charge: where it is and how it moves. It falls from where it is dropped, then rolls down slopes. */
  const charges: { object: THREE.Group; at: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }[] = [];
  const blastBtn = $('#blast');
  const BLAST_R = 15;
  const SMOKE = new THREE.Color(0x6b5a4c);
  const FIRE = new THREE.Color(0xff9a3c);
  let lastDrop = -10;
  let shake = 0;
  const refreshBlast = () => {
    if (blastBtn) blastBtn.hidden = !progress.explosives;
  };
  refreshBlast();
  function dropCharge() {
    if (!progress.explosives || !playing || time - lastDrop < 0.5) return;
    lastDrop = time;
    const object = makeCharge();
    object.rotation.y = heading;
    scene.add(object);
    // Dropped from below the drone with its speed, or set down by the ghost or a machine.
    const ground = Math.max(heightAt(pos.x, pos.z), 0);
    const y = mode === 'drone' ? pos.y - 0.8 : ground + 0.6;
    charges.push({ object, at: time, x: pos.x, y, z: pos.z, vx: vel.x * 0.8, vy: mode === 'drone' ? vy * 0.5 : 0, vz: vel.z * 0.8 });
  }
  $$('[data-blast]').forEach((b) => b.addEventListener('click', dropCharge));

  function updateCharges(dt: number) {
    // The stash on the mountain top: walked into, driven into, or flown low over.
    if (!progress.explosives && Math.hypot(pos.x - CAVE.x, pos.z - CAVE.z) < 5 && pos.y - heightAt(pos.x, pos.z) < 8) {
      progress.explosives = true;
      saveProgress();
      refreshBlast();
      toast(
        touchFirst()
          ? t('A secret stash! A crate of explosives. The bomb button drops a charge: it falls, rolls downhill, and goes off. Stand back.', 'Una scorta segreta! Una cassa di esplosivi. Il pulsante della bomba lascia una carica: cade, rotola in discesa ed esplode. Allontanati.')
          : t('A secret stash! A crate of explosives. X drops a charge: it falls, rolls downhill, and goes off. Stand back.', 'Una scorta segreta! Una cassa di esplosivi. X lascia una carica: cade, rotola in discesa ed esplode. Allontanati.'),
      );
    }
    for (let i = charges.length - 1; i >= 0; i--) {
      const c = charges[i];
      const age = time - c.at;
      (c.object.userData.light as THREE.Object3D).visible = Math.floor(age * (age > 1.4 ? 14 : 5)) % 2 === 0;
      // Gravity; on the ground it bounces a little, then slides and rolls down the slope.
      const ground = heightAt(c.x, c.z);
      const floor = Math.max(ground, 0);
      c.vy -= 24 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      if (ground < 0 && c.y < 0) {
        // In the sea: it sinks, slowly.
        c.vy = Math.max(c.vy, -1.5);
        c.vx *= Math.exp(-3 * dt);
        c.vz *= Math.exp(-3 * dt);
      } else if (c.y <= floor + 0.15) {
        c.y = floor + 0.15;
        c.vy = c.vy < -5 ? -c.vy * 0.3 : 0;
        const gx = heightAt(c.x + 0.6, c.z) - heightAt(c.x - 0.6, c.z);
        const gz = heightAt(c.x, c.z + 0.6) - heightAt(c.x, c.z - 0.6);
        c.vx += (-gx / 1.2) * 22 * dt;
        c.vz += (-gz / 1.2) * 22 * dt;
        c.vx *= Math.exp(-1.6 * dt);
        c.vz *= Math.exp(-1.6 * dt);
      }
      c.object.position.set(c.x, c.y, c.z);
      c.object.rotation.x += Math.hypot(c.vx, c.vz) * dt * 1.5;
      if (age < 2) continue;
      scene.remove(c.object);
      charges.splice(i, 1);
      const wet = ground < 0.2 && c.y < 0.6;
      // Under water it only throws up spray.
      const { cleared } = wet ? { cleared: 0 } : world.blast(c.x, c.z, BLAST_R);
      for (let j = 0; j < 28; j++) dust.emit(c.x, Math.max(c.y, 0) + 0.5 + Math.random() * 2, c.z, wet ? SPRAY : j % 3 ? SMOKE : FIRE, 7, 3.4);
      shake = Math.max(shake, clamp(1.4 - Math.hypot(pos.x - c.x, pos.z - c.z) / 60, 0, 1.4));
      if (cleared && !litter.some((pile) => pile.object.visible) && !progress.litter) {
        progress.litter = true;
        saveProgress();
        toast(t('Boom! The litter is gone, and the road to the harbour is open.', 'Boom! La spazzatura è sparita, e la strada per il porto è aperta.'));
      }
    }
  }

  // ---------- Pieralisi: the charge bar ----------
  // A bar of energy floating over the motor's bench, always turned to the view: red when empty,
  // green when full.

  const motorMachine = machines.find((m) => m.kind === 'motor');
  const chargeBar = new THREE.Group();
  const barBack = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.62), new THREE.MeshBasicMaterial({ color: 0x1d1a16, transparent: true, opacity: 0.85, depthWrite: false }));
  const barFill = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.44).translate(2, 0, 0), new THREE.MeshBasicMaterial({ color: 0xe0602c }));
  barFill.position.set(-2, 0, 0.01);
  chargeBar.add(barBack, barFill);
  for (let i = 1; i < 4; i++) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.44), new THREE.MeshBasicMaterial({ color: 0x1d1a16 }));
    tick.position.set(-2 + i, 0, 0.02);
    chargeBar.add(tick);
  }
  chargeBar.visible = !!motorMachine;
  scene.add(chargeBar);
  const updateChargeBar = () => {
    if (!motorMachine) return;
    motorMachine.object.getWorldPosition(vp);
    chargeBar.position.set(vp.x, vp.y + 4.2, vp.z);
    chargeBar.quaternion.copy(camera.quaternion);
    barFill.scale.x = Math.max(0.001, charge);
    (barFill.material as THREE.MeshBasicMaterial).color.setHSL(0.33 * charge, 0.75, 0.5);
    chargeBar.visible = Math.hypot(vp.x - pos.x, vp.z - pos.z) < 90;
  };

  // ---------- Activities on the mountain ----------
  // Lega del Filo d'Oro (data engineering): gather the data packets into a pipeline, and the
  // dashboard lights up. Inim (security and video): switch on the four sensors around the office,
  // then arm the system at the control panel.

  const tasks = world.tasks;
  const lfoSite = sites.find((s) => s.def.model === 'residential');
  const inimSite = sites.find((s) => s.def.model === 'office');
  const lfoLeft = () => tasks.lfo?.cubes.filter((c) => c.visible).length ?? 0;
  const inimLeft = () => tasks.inim?.sensors.filter((s) => !s.userData.on).length ?? 0;
  const near = (o: THREE.Object3D, reach: number) => {
    o.getWorldPosition(vp);
    return Math.hypot(vp.x - pos.x, vp.z - pos.z) < reach && pos.y - vp.y < 10;
  };
  const GREEN = new THREE.Color(0x3fd46a);
  if (progress.lfoDone && tasks.lfo) {
    tasks.lfo.cubes.forEach((c) => (c.visible = false));
    tasks.lfo.dashboard.visible = true;
  }
  if (progress.inimDone && tasks.inim) {
    for (const sensor of tasks.inim.sensors) sensor.userData.on = true;
  }
  function updateTasks() {
    if (tasks.lfo) {
      tasks.lfo.cubes.forEach((cube, i) => {
        if (!cube.visible) return;
        cube.rotation.y = time * 1.2 + i;
        cube.position.y = heightAt(cube.position.x, cube.position.z) + 1.4 + Math.sin(time * 2 + i) * 0.25;
        if (!near(cube, 3)) return;
        cube.visible = false;
        dust.emit(cube.position.x, cube.position.y, cube.position.z, SPRAY, 1, 1.2);
        const left = lfoLeft();
        if (left) toast(t(`Data packet loaded into the pipeline: ${left} to go.`, `Pacchetto di dati caricato nella pipeline: ne mancano ${left}.`), true);
        else if (!progress.lfoDone) {
          progress.lfoDone = true;
          saveProgress();
          tasks.lfo!.dashboard.visible = true;
          toast(t('Pipeline complete: the data reaches BigQuery and the access dashboard lights up. Well done!', 'Pipeline completata: i dati arrivano su BigQuery e la dashboard degli accessi si accende. Ottimo lavoro!'));
        }
      });
    }
    if (tasks.inim) {
      for (const sensor of tasks.inim.sensors) {
        const on = !!sensor.userData.on;
        const led = sensor.userData.led as THREE.Mesh;
        const ring = sensor.userData.ring as THREE.Mesh;
        (led.material as THREE.MeshBasicMaterial).color.set(on ? GREEN : Math.floor(time * 3) % 2 ? 0xff3020 : 0x6a1410);
        (ring.material as THREE.MeshBasicMaterial).color.set(on ? GREEN : 0xff3020);
        if (on || !near(sensor, 3.2)) continue;
        sensor.userData.on = true;
        const left = inimLeft();
        toast(left ? t(`Sensor online: ${left} to go.`, `Sensore attivo: ne mancano ${left}.`) : t('All sensors online. Now arm the system at the control panel.', 'Tutti i sensori attivi. Ora inserisci l’allarme dal pannello di controllo.'), true);
      }
      const led = tasks.inim.panel.userData.led as THREE.Mesh;
      (led.material as THREE.MeshBasicMaterial).color.set(progress.inimDone ? GREEN : 0xff3020);
      if (!progress.inimDone && !inimLeft() && near(tasks.inim.panel, 3.5)) {
        progress.inimDone = true;
        saveProgress();
        shieldDownAt = time;
        toast(t('System armed: Inim is secure. The force field over the AI engineer platform comes down.', 'Allarme inserito: Inim è al sicuro. Il campo di forza sulla piattaforma dell’AI engineer si spegne.'));
      }
    }
  }

  // ---------- The AI engineer platform: shielded until Inim is secure ----------
  // A dome of energy covers the profile among the skills; it comes down once Inim's alarm system
  // is armed. Until then nothing gets through, on foot or in the air, and the place cannot be known.

  const profileSite = sites.find((s) => s.def.model === 'pylons');
  const shieldR = profileSite ? profileSite.def.r + 2.5 : 0;
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, TAU, 0, Math.PI / 2), shieldMaterial);
  if (profileSite) {
    shield.position.set(profileSite.def.x, profileSite.y - 0.2, profileSite.def.z);
    shield.scale.setScalar(shieldR);
    scene.add(shield);
  }
  let shieldDownAt = progress.inimDone ? -100 : Infinity;
  const shielded = (site: Site | null | undefined) => !!site && site === profileSite && shieldDownAt === Infinity;
  function updateShield() {
    if (!profileSite) return;
    const f = clamp((time - shieldDownAt) / 1.5, 0, 1);
    shield.visible = f < 1;
    shieldMaterial.opacity = (0.18 + Math.sin(time * 3) * 0.05) * (1 - f);
    shield.scale.setScalar(shieldR * (1 + f * 0.3));
    if (shieldDownAt < Infinity || mode === 'camera' || mode === 'motor') return;
    const dx = pos.x - profileSite.def.x;
    const dz = pos.z - profileSite.def.z;
    const d = Math.hypot(dx, dz);
    const dy = pos.y - profileSite.y;
    // Inside the dome's outline, in plan and in height: pushed back out.
    if (d < shieldR + 1 && dy < Math.sqrt(Math.max(0, (shieldR + 1) ** 2 - d * d))) {
      pos.x = profileSite.def.x + (dx / (d || 1)) * (shieldR + 1.2);
      pos.z = profileSite.def.z + (dz / (d || 1)) * (shieldR + 1.2);
      spd *= 0.3;
      vel.multiplyScalar(0.3);
      warn(t('A force field protects the AI engineer platform. Secure Inim Electronics first: arm its alarm system.', 'Un campo di forza protegge la piattaforma dell’AI engineer. Prima metti in sicurezza Inim Electronics: inserisci il suo allarme.'));
    }
  }

  // ---------- Objective ----------
  // What to do next, worked out from the progress: shown as a line at the top, an arrow in the
  // world over where to go, and a ring on the minimap. Obstacles are named only once met.

  const objectiveEl = $('#objective');
  const guide = makeGuide();
  scene.add(guide);
  let goal: { text: string; at: { x: number; z: number } | null } = { text: '', at: null };
  const machineOf = (kind: VehicleKind) => machines.find((m) => m.kind === kind && (kind !== 'camera' || m.watch === 'checkpoint'));
  const whereIs = (m?: Machine) => (m ? (machineAt(m, vp), { x: vp.x, z: vp.z }) : null);
  const placeAt = (site?: Site) => (site ? { x: site.def.x, z: site.def.z } : null);
  const E = () => (touchFirst() ? t('“Possess”', '“Possiedi”') : 'E');

  function objective(): { text: string; at: { x: number; z: number } | null } {
    const has = (k: VehicleKind) => progress.met.has(k);
    const zone = (z: Zone) => progress.zones.has(z);
    const robot = machineOf('robot');
    if (!has('bike')) return { text: t(`Possess the e-bike just past the university (${E()})`, `Possiedi l’e-bike subito dopo l’università (${E()})`), at: whereIs(machineOf('bike')) };
    if (!zone('plateau')) return { text: t('Ride the e-bike up the ramp to the plateau', 'Sali con l’e-bike sulla rampa fino all’altopiano'), at: RAMP };
    if (!has('car')) return { text: t('Possess the Bosch car on its circuit', 'Possiedi l’auto della Bosch sul suo circuito'), at: whereIs(machineOf('car')) };
    if (crowdSite && !log.has(crowdSite.def.id)) {
      if (!progress.metCrowd) return { text: t('Drive on toward the river', 'Prosegui verso il fiume'), at: CROWD };
      return { text: t(`Tourists block the road: find out why at ${crowdSite.def.title}, down the side path`, `I turisti bloccano la strada: scopri perché a ${crowdSite.def.title}, lungo il sentiero laterale`), at: placeAt(crowdSite) };
    }
    if (!zone('valley')) return { text: t('Jump the river: the Bosch car at full speed, over the ramp', 'Salta il fiume: l’auto della Bosch a tutta velocità, sul trampolino'), at: RIVER_CROSSING };
    if (!progress.identified) {
      if (!progress.metGuard) return { text: t('Follow the road through the valley', 'Segui la strada attraverso la valle'), at: GUARD };
      if (superRes && !log.has(superRes.def.id)) return { text: t(`The camera is blurry: learn from ${superRes.def.title}, down the side path`, `La telecamera è sfocata: impara da ${superRes.def.title}, lungo il sentiero laterale`), at: placeAt(superRes) };
      return { text: t(`Possess the security camera (${E()}) and hold the glowing weapon in view`, `Possiedi la telecamera (${E()}) e tieni inquadrata l’arma che brilla`), at: whereIs(machineOf('camera')) };
    }
    if (!has('robot')) return { text: t('Possess the litter robot in the yard', 'Possiedi il robot spazzino nel cortile'), at: whereIs(robot) };
    if (!progress.litter) return { text: t('Drive the litter robot into the litter in the gorge', 'Guida il robot spazzino contro la spazzatura nella gola'), at: GORGE };
    if (!progress.gps && gpsSite) return { text: t(`Visit ${gpsSite.def.title} at the harbour: it switches the GPS on`, `Visita ${gpsSite.def.title} al porto: accende il GPS`), at: placeAt(gpsSite) };
    if (!has('boat')) return { text: t(`Possess the boat from the shore (${E()})`, `Possiedi la barca dalla riva (${E()})`), at: whereIs(machineOf('boat')) };
    if (!zone('islet')) return { text: t('Sail east to the islet', 'Naviga verso est fino all’isolotto'), at: ISLET_DOCK };
    if (!progress.flight) {
      const lesson = lessons.find((s) => !log.has(s.def.id));
      if (lesson) return { text: t(`Learn how to fix the drone: visit the projects on the plaza (${lessons.filter((s) => !log.has(s.def.id)).length} to go)`, `Impara ad aggiustare il drone: visita i progetti della piazza (ne mancano ${lessons.filter((s) => !log.has(s.def.id)).length})`), at: placeAt(lesson) };
      if (!progress.charged) return { text: t('Possess the Pieralisi motor and hold forward to charge the drone', 'Possiedi il motore della Pieralisi e tieni premuto avanti per caricare il drone'), at: whereIs(machineOf('motor')) };
      return { text: t(`Possess the drone in its vault (${E()})`, `Possiedi il drone nel suo caveau (${E()})`), at: whereIs(machineOf('drone')) };
    }
    const court = world.court;
    const courtCam = machines.find((m) => m.watch === 'court');
    if (court && !progress.referee && sites.some((s) => s.def.zone === 'mountain' && log.has(s.def.id))) {
      return { text: t(`A player hits anyone near the court: land by the camera beside it, leave the drone (${E()}) and possess the camera`, `Un giocatore colpisce chi si avvicina al campo: atterra vicino alla telecamera lì accanto, lascia il drone (${E()}) e possiedi la telecamera`), at: whereIs(courtCam) };
    }
    // The activities at the two workplaces up here, once each place is known.
    if (lfoSite && tasks.lfo && log.has(lfoSite.def.id) && !progress.lfoDone) {
      const next = tasks.lfo.cubes.find((c) => c.visible);
      return { text: t(`Lega del Filo d’Oro: gather the data packets for the pipeline (${lfoLeft()} to go)`, `Lega del Filo d’Oro: raccogli i pacchetti di dati per la pipeline (ne mancano ${lfoLeft()})`), at: next ? { x: next.position.x, z: next.position.z } : null };
    }
    if (inimSite && tasks.inim && log.has(inimSite.def.id) && !progress.inimDone) {
      if (inimLeft()) {
        const next = tasks.inim.sensors.find((x) => !x.userData.on)!;
        return { text: t(`Inim Electronics: switch on the alarm sensors around the office (${inimLeft()} to go)`, `Inim Electronics: attiva i sensori d’allarme attorno all’ufficio (ne mancano ${inimLeft()})`), at: { x: next.position.x, z: next.position.z } };
      }
      return { text: t('Inim Electronics: arm the system at the control panel', 'Inim Electronics: inserisci l’allarme dal pannello di controllo'), at: { x: tasks.inim.panel.position.x, z: tasks.inim.panel.position.z } };
    }
    const left = sites.filter((s) => !log.has(s.def.id) && !shielded(s));
    if (!left.length && shielded(profileSite) && inimSite) {
      return { text: t('Secure Inim Electronics to bring down the force field over the AI engineer platform', 'Metti in sicurezza Inim Electronics per spegnere il campo di forza sulla piattaforma dell’AI engineer'), at: { x: inimSite.def.x, z: inimSite.def.z } };
    }
    if (!left.length) return { text: '', at: null };
    let nearest = left[0];
    for (const s of left) if (Math.hypot(s.def.x - pos.x, s.def.z - pos.z) < Math.hypot(nearest.def.x - pos.x, nearest.def.z - pos.z)) nearest = s;
    const what =
      left.length === 1
        ? t(`the last place: ${nearest.def.title}`, `l’ultimo luogo: ${nearest.def.title}`)
        : t(`${left.length} places left; the nearest is ${nearest.def.title}`, `mancano ${left.length} luoghi; il più vicino è ${nearest.def.title}`);
    return { text: progress.flight ? t(`Fly on: ${what}`, `Vola avanti: ${what}`) : t(`Go on: ${what}`, `Avanti: ${what}`), at: placeAt(nearest) };
  }

  function updateObjective() {
    goal = objective();
    if (objectiveEl) {
      objectiveEl.textContent = goal.text;
      objectiveEl.hidden = !goal.text || !playing;
    }
  }

  // ---------- Minimap ----------

  const map = $<HTMLCanvasElement>('#minimap');
  const mapBase = document.createElement('canvas');
  /** Size of the minimap in CSS pixels: larger on a computer (see the page's styles). */
  let MAP_PX = 168;
  const MAP_R = 356;
  const toMap = (x: number, z: number) => [MAP_PX / 2 + (x / MAP_R) * (MAP_PX / 2), MAP_PX / 2 + (z / MAP_R) * (MAP_PX / 2)];
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

  function drawMapBase() {
    if (!map) return;
    MAP_PX = map.clientWidth || 168;
    const dpr = Math.min(window.devicePixelRatio, 2);
    for (const c of [map, mapBase]) {
      c.width = MAP_PX * dpr;
      c.height = MAP_PX * dpr;
    }
    const p = PALETTE;
    const ctx = mapBase.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_PX, MAP_PX);
    const shape = (at: (b: number) => { x: number; z: number }) => {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const q = at((i / 120) * TAU);
        const [x, y] = toMap(q.x, q.z);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    for (const at of [(b: number) => polar(b, coastRadius(b)), (b: number) => isletShore(b)]) {
      shape(at);
      ctx.fillStyle = hex(p.structure);
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = hex(p.shore);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // The mountain: its top and the massif out to the cape.
    ctx.beginPath();
    ctx.moveTo(...(toMap(0, 0) as [number, number]));
    for (let d = BORDER.massifStart; d <= BORDER.massifEnd; d += 4) {
      const q = polar(rad(d), coastRadius(rad(d)));
      ctx.lineTo(...(toMap(q.x, q.z) as [number, number]));
    }
    ctx.closePath();
    ctx.fillStyle = hex(p.dark);
    ctx.globalAlpha = 0.5;
    ctx.fill();
    const [cx, cy] = toMap(0, 0);
    ctx.beginPath();
    ctx.arc(cx, cy, (FOOT_R / MAP_R) * (MAP_PX / 2), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    // The river.
    const r0 = polar(rad(BORDER.river), FOOT_R);
    const r1 = polar(rad(BORDER.river), coastRadius(rad(BORDER.river)));
    ctx.beginPath();
    ctx.moveTo(...(toMap(r0.x, r0.z) as [number, number]));
    ctx.lineTo(...(toMap(r1.x, r1.z) as [number, number]));
    ctx.strokeStyle = hex(p.pool);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    mainRoad.pts.forEach((q, i) => {
      const [x, y] = toMap(q.x, q.z);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = hex(p.road);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawMapBase();

  // The objective and the minimap follow the language at once.
  onLang(() => {
    if (playing) updateObjective();
  });

  function drawMap() {
    if (!map) return;
    const p = PALETTE;
    const dpr = map.width / MAP_PX;
    const ctx = map.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, map.width, map.height);
    // No GPS yet: static, and a hint at where to find it.
    if (!progress.gps) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = hex(p.light);
        ctx.globalAlpha = 0.08 + Math.random() * 0.15;
        ctx.fillRect(Math.random() * MAP_PX, Math.random() * MAP_PX, 2 + Math.random() * 10, 1.5);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = hex(p.light);
      ctx.font = '600 11px "JetBrains Mono Variable", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t('NO GPS', 'NIENTE GPS'), MAP_PX / 2, MAP_PX / 2 - 2);
      ctx.font = '500 8px "JetBrains Mono Variable", ui-monospace, monospace';
      ctx.fillText(t('see GeoPosBall', 'vedi GeoPosBall'), MAP_PX / 2, MAP_PX / 2 + 11);
      return;
    }
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
    for (const m of machines) {
      if (m === taken) continue;
      machineAt(m, vp);
      const [vx, vy2] = toMap(vp.x, vp.z);
      ctx.beginPath();
      ctx.arc(vx, vy2, 3, 0, TAU);
      ctx.stroke();
    }
    if (goal.at) {
      const [gx, gy] = toMap(goal.at.x, goal.at.z);
      ctx.beginPath();
      ctx.arc(gx, gy, 6 + Math.sin(time * 5) * 1.5, 0, TAU);
      ctx.strokeStyle = hex(p.signal);
      ctx.lineWidth = 2;
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

  let baseFov = 58;
  /** The view through a security camera: wide, so the whole crowd or court is in the picture. */
  const CAMERA_FOV = 46;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    composer?.setSize(w, h);
    drawMapBase();
    dust.resize(h * pixelRatio);
    camera.aspect = w / h;
    baseFov = w < h ? 70 : 58;
    camera.fov = mode === 'camera' ? CAMERA_FOV : baseFov;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Quality ----------
  // If frames run slow after the start, the effects go first, then the resolution drops a step at
  // a time down to 1, then the shadows go. It never climbs back, so the picture does not flicker between levels.

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
    // The effects go below about 50 frames a second. The rest goes below about 28; a phone capped at
    // 30 by its battery saver is left alone.
    if (composer && average > 1 / 50) {
      composer.dispose();
      composer = null;
      return;
    }
    if (average < 1 / 28) return;
    if (pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      dust.resize(window.innerHeight * pixelRatio);
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
    /**
     * How far the tourists have moved aside: 0 while they crowd the road, 1 once they are all gone.
     * They leave one after another, at a stroll, so it takes a good ten seconds.
     */
    const crowdLeft = (i: number) => {
      const f = clamp((time - crowdAt - i * CROWD_GAP) / CROWD_WALK, 0, 1);
      return f * f * (3 - 2 * f);
    };
    const crowdF = clamp((time - crowdAt) / (CROWD_GAP * (world.crowd.length - 1) + CROWD_WALK), 0, 1);
    // Controls: forward and back, turn, rise and sink.
    let fwd = 0;
    let turn = 0;
    let up = rise;
    if (playing) {
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

    if (autopilot && mode === 'drone') {
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

    const spec = SPEC[mode];
    const prevX = pos.x;
    const prevY = pos.y;
    const prevZ = pos.z;
    let speed = 0;
    if (mode === 'ghost') {
      // Walks, and turns on the spot. The sea stops it.
      heading += turn * spec.turn * dt;
      forward.set(-Math.sin(heading), 0, -Math.cos(heading));
      spd = lerp(spd, fwd * spec.top, 1 - Math.exp(-6 * dt));
      const nx = pos.x + forward.x * spd * dt;
      const nz = pos.z + forward.z * spd * dt;
      const wet = heightAt(nx, nz) <= 0.3;
      const reason = wet ? null : blocked(here, zoneOf(nx, nz), nx, nz);
      if (!wet && !reason && Math.hypot(nx, nz) < WORLD_R) {
        pos.x = nx;
        pos.z = nz;
      } else {
        spd = 0;
        warn(reason ?? shoreReason());
      }
      pos.y = heightAt(pos.x, pos.z);
      vel.set(forward.x * spd, 0, forward.z * spd);
      vy = 0;
      speed = Math.abs(spd);
    } else if (mode === 'camera') {
      // Pans left and right; held on the armed man, it identifies his weapon.
      heading += turn * spec.turn * dt;
      if (taken) taken.object.rotation.y = heading + Math.PI;
      vel.set(0, 0, 0);
      vy = 0;
    } else if (mode === 'motor') {
      // Forward spins the motor up; at full speed it charges the drone in about six seconds.
      rpm = lerp(rpm, Math.max(fwd, 0), 1 - Math.exp(-1.2 * dt));
      if (taken) taken.object.userData.boost = rpm;
      if (!progress.charged) {
        charge = Math.min(1, charge + (rpm * dt) / 6);
        if (charge >= 1) {
          progress.charged = true;
          saveProgress();
          const needs = droneNeeds();
          toast(needs.length ? t(`Drone charged! Still to do before it flies: ${listOf(needs)}.`, `Drone carico! Prima che voli resta da fare: ${listOf(needs)}.`) : t('Drone charged and fixed! It waits in the vault.', 'Drone carico e aggiustato! Ti aspetta nel caveau.'));
        }
      }
      vel.set(0, 0, 0);
      vy = 0;
    } else if (mode === 'drone') {
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
      if (jump) {
        // In the air over the river: straight on, along an arc, until the far bank.
        jump.t += dt;
        pos.x = nx;
        pos.z = nz;
        const f = jump.t / JUMP_TIME;
        pos.y = jump.y0 + 18 * f * (1 - f) + (heightAt(nx, nz) > 0 ? (heightAt(nx, nz) - jump.y0) * f : -2 * f);
        if (f >= 1) {
          jump = null;
          if (heightAt(pos.x, pos.z) > 0.3) {
            pos.y = heightAt(pos.x, pos.z);
            for (let i = 0; i < 14; i++) dust.emit(pos.x, pos.y + 0.3, pos.z, DUST, 3, 2.2);
            if (!progress.zones.has('valley')) toast(t('What a jump!', 'Che salto!'));
          } else {
            // Short: back to the run-up.
            const back = roadAt(BORDER.river) - 24;
            const p = mainAt(back);
            const q = mainAt(back + 4);
            pos.set(p.x, heightAt(p.x, p.z), p.z);
            heading = Math.atan2(-(q.x - p.x), -(q.z - p.z));
            spd = 0;
            toast(t('Splash! The car needs a longer run-up to clear the river.', 'Splash! All’auto serve una rincorsa più lunga per superare il fiume.'));
          }
        }
      } else {
        const h = heightAt(nx, nz);
        const fits = mode === 'boat' ? h < -0.6 : h > 0.3;
        const reason = mode === 'boat' || !fits ? null : blocked(here, zoneOf(nx, nz), nx, nz);
        if (fits && !reason && Math.hypot(nx, nz) < WORLD_R) {
          pos.x = nx;
          pos.z = nz;
        } else if (!fits && mode === 'car' && spd > JUMP_SPEED && here === 'plateau' && nearRiver(pos.x, pos.z) && crowdF >= 1) {
          jump = { t: 0, y0: pos.y };
        } else {
          spd *= -0.2;
          warn(reason ?? shoreReason());
        }
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
      warn(t('Edge of the survey area: turn back to the island.', 'Limite dell’area: torna verso l’isola.'));
    }

    // Buildings: slide around the solid parts. The motor does not move.
    const flying = mode === 'drone';
    // The motor and the camera do not move.
    const fixed = mode === 'motor' || mode === 'camera';
    for (const solids of fixed ? [] : [...sites.map((s) => s.solid), world.walls]) {
      for (const [sx, sz, sr, top] of solids) {
        if (flying && pos.y > top + 0.8) continue;
        const dx = pos.x - sx;
        const dz = pos.z - sz;
        const d = Math.hypot(dx, dz);
        const min = sr + (flying ? 1.2 : mode === 'ghost' ? 0.8 : 0.9 * rigScale);
        if (d < min) {
          if (flying && pos.y > top - 1.2) pos.y = top + 0.8;
          else {
            const k = d > 0.01 ? min / d : 1;
            pos.x = sx + dx * k;
            pos.z = sz + dz * k;
            if (!flying) spd *= 0.6;
          }
        }
      }
    }

    // The tourists: solid while they crowd the road, then they walk to the roadside.
    world.crowd.forEach(({ object, from, to }, i) => {
      const f = crowdLeft(i);
      const x = lerp(from.x, to.x, f);
      const z = lerp(from.z, to.z, f);
      // A little bob while walking.
      object.position.set(x, heightAt(x, z) + (f > 0 && f < 1 ? Math.abs(Math.sin(time * 9 + i)) * 0.12 : 0), z);
      if (f > 0 && f < 1) object.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      if (f < 0.6 && mode !== 'drone' && mode !== 'motor' && mode !== 'camera') {
        const dx = pos.x - x;
        const dz = pos.z - z;
        const d = Math.hypot(dx, dz);
        const min = 0.6 + (mode === 'ghost' ? 0.6 : 0.9 * rigScale);
        if (d < min) {
          pos.x = x + (dx / (d || 1)) * min;
          pos.z = z + (dz / (d || 1)) * min;
          spd *= 0.5;
          if (!progress.metCrowd) {
            progress.metCrowd = true;
            saveProgress();
          }
          warn(
            crowdSite
              ? t(`Tourists crowd the road: some event is on. The side path just back there leads to ${crowdSite.def.title}, which might explain it.`, `I turisti affollano la strada: c’è qualche evento. Il sentiero laterale poco indietro porta a ${crowdSite.def.title}, che potrebbe spiegarlo.`)
              : t('Tourists crowd the road.', 'I turisti affollano la strada.'),
          );
        }
      }
    });

    // Until most of them have gone, the crowd as a whole closes the road between the boulders.
    if (crowdF < 0.5 && !flying && !fixed) {
      const dx = pos.x - CROWD.x;
      const dz = pos.z - CROWD.z;
      const d = Math.hypot(dx, dz);
      if (d < 9) {
        pos.x = CROWD.x + (dx / (d || 1)) * 9;
        pos.z = CROWD.z + (dz / (d || 1)) * 9;
        spd *= 0.5;
      }
    }

    // The checkpoint: the armed man shoots at anyone who comes close on the ground, until the
    // camera identifies his weapon. Then the police come and send him flying out over the ocean.
    const cp = world.checkpoint;
    const shooter = cp.shooter.group;
    const T = time - guardAt;
    /** A point of the checkpoint, `along` the road from it and `across` (outward). */
    const atCheckpoint = (along: number, across: number) => {
      const q = mainAt(cp.s + along);
      return polar(Math.atan2(q.x, -q.z), Math.hypot(q.x, q.z) + across);
    };
    // The passers-by mill around the road, and step aside once the police arrive.
    cp.people.forEach((one, i) => {
      const aside = clamp((T - 1) / 3, 0, 1);
      const across = [-3, 2, -1, 3.5, 0.5][i] + Math.cos(time * 0.33 + i * 1.7) * 1.2;
      const at = atCheckpoint([-6, -3, -1, 2, -4.5][i] + Math.sin(time * 0.4 + i) * 1.2, across + Math.sign(across || 1) * 11 * aside);
      one.position.set(at.x, heightAt(at.x, at.z), at.z);
      one.rotation.y += dt * 0.3 * (i % 2 ? 1 : -1);
    });
    if (!progress.identified || T < 3.5) {
      const at = atCheckpoint(-2 + Math.sin(time * 0.3) * 1.5, 1.5 * Math.cos(time * 0.27));
      shooter.position.set(at.x, heightAt(at.x, at.z), at.z);
      shooter.visible = true;
    }
    const sx = shooter.position.x;
    const sz = shooter.position.z;
    if (!progress.identified && mode !== 'drone' && mode !== 'camera' && mode !== 'motor') {
      const dx = pos.x - sx;
      const dz = pos.z - sz;
      const d = Math.hypot(dx, dz);
      if (d < 40) shooter.rotation.y = Math.atan2(dx, dz);
      if (d < 22 && time - shotAt > 0.8) {
        shotAt = time;
        if (!progress.metGuard) {
          progress.metGuard = true;
          saveProgress();
        }
        // Thrown back toward the valley.
        pos.x = sx + (dx / (d || 1)) * 30;
        pos.z = sz + (dz / (d || 1)) * 30;
        if (zoneOf(pos.x, pos.z) !== 'valley') {
          const back = mainAt(cp.s - 30);
          pos.x = back.x;
          pos.z = back.z;
        }
        pos.y = heightAt(pos.x, pos.z);
        spd = 0;
        vel.set(0, 0, 0);
        toast(
          superRes && !log.has(superRes.def.id)
            ? t(`Bang! Someone at the checkpoint is armed. A security camera watches the road, but its picture is too blurry: the side path just back there leads to ${superRes.def.title}.`, `Bang! Qualcuno al posto di blocco è armato. Una telecamera sorveglia la strada, ma l’immagine è troppo sfocata: il sentiero laterale poco indietro porta a ${superRes.def.title}.`)
            : t('Bang! Someone at the checkpoint is armed. The security camera by the road can tell who.', 'Bang! Qualcuno al posto di blocco è armato. La telecamera a bordo strada può dirti chi.'),
        );
      }
    }
    cp.shooter.flash.visible = time - shotAt < 0.12;
    // Through the camera the weapon glows.
    cp.shooter.halo.visible = mode === 'camera' && taken?.watch === 'checkpoint' && !progress.identified;
    if (cp.shooter.halo.visible) cp.shooter.halo.scale.setScalar(1 + Math.sin(time * 6) * 0.15);

    if (guardAt < Infinity) {
      // The police car comes down the road from the yard, and later leaves the same way.
      const come = clamp(T / 3, 0, 1);
      const go = clamp((T - 7) / 3, 0, 1);
      const along = lerp(70, 8, come * (2 - come)) + lerp(0, 62, go * go);
      const car = cp.police.group;
      car.visible = T < 10;
      const p = mainAt(cp.s + along);
      const q = mainAt(cp.s + along + 1);
      car.position.set(p.x, heightAt(p.x, p.z), p.z);
      car.rotation.y = Math.atan2(q.x - p.x, q.z - p.z) + (go > 0 ? 0 : Math.PI);
      cp.police.lights.forEach((light, i) => (light.visible = Math.floor(time * 6) % 2 === i));
      // The barrier lifts.
      cp.barrier.arm.rotation.z = lerp(0, 1.35, clamp((T - 3) / 1, 0, 1));
      // Out over the ocean, spinning.
      if (T >= 3.5) {
        const f = clamp((T - 3.5) / 3, 0, 1);
        const from = atCheckpoint(-2, 0);
        const b = Math.atan2(from.x, -from.z);
        const to = polar(b, coastRadius(b) + 110);
        const ground = heightAt(from.x, from.z);
        shooter.position.set(lerp(from.x, to.x, f), ground + 55 * 4 * f * (1 - f) - 10 * f, lerp(from.z, to.z, f));
        shooter.rotation.set(time * 7, time * 5, 0);
        shooter.visible = f < 1;
      }
    }

    // The volleyball court: the player in the middle spikes the ball at anyone who comes close,
    // on foot or in the air, until the court's camera identifies him; then he leaves the court.
    const court = world.court;
    if (court) {
      const hitter = court.hitter.group;
      const REACH = 34;
      if (!progress.referee && !fixed) {
        const dx = pos.x - court.x;
        const dz = pos.z - court.z;
        const d = Math.hypot(dx, dz);
        if (d < 50) hitter.rotation.y = Math.atan2(dx, dz);
        if (d < REACH && time - spikeAt > 0.9) {
          spikeAt = time;
          hitter.getWorldPosition(spikeFrom);
          spikeFrom.y += 3.4;
          spikeTo.copy(pos);
          // Knocked back, and kept on the top of the mountain.
          let nx = court.x + (dx / (d || 1)) * (REACH + 8);
          let nz = court.z + (dz / (d || 1)) * (REACH + 8);
          if (zoneOf(nx, nz) !== here) {
            const c = Math.hypot(court.x, court.z) || 1;
            nx = court.x - (court.x / c) * (REACH + 8);
            nz = court.z - (court.z / c) * (REACH + 8);
          }
          pos.x = nx;
          pos.z = nz;
          if (mode !== 'drone') pos.y = heightAt(nx, nz);
          spd = 0;
          vel.set(0, 0, 0);
          toast(t('Spike! The player in the middle of the court keeps hitting you. The camera beside the court can identify him.', 'Schiacciata! Il giocatore in mezzo al campo continua a colpirti. La telecamera accanto al campo può identificarlo.'));
        }
      }
      const ball = court.hitter.ball;
      const bf = (time - spikeAt) / 0.35;
      ball.visible = bf < 1;
      if (ball.visible) ball.position.lerpVectors(spikeFrom, spikeTo, bf).setY(lerp(spikeFrom.y, spikeTo.y, bf) + 3 * bf * (1 - bf));
      court.hitter.halo.visible = mode === 'camera' && taken?.watch === 'court' && !progress.referee;
      if (courtAt < Infinity) {
        // Identified, and sent off: a carnivorous plant comes up under him, opens wide, snaps
        // shut, chews, and sinks back into the ground.
        const T = time - courtAt;
        const plant = court.plant;
        const jaw = plant.userData.jaw as THREE.Object3D;
        const head = plant.userData.head as THREE.Object3D;
        const rise = clamp(T / 0.9, 0, 1);
        const sink = clamp((T - 3.4) / 1.2, 0, 1);
        plant.visible = T < 4.6;
        plant.scale.set(1.6, 1.6 * Math.max(0.01, rise * (1 - sink)), 1.6);
        plant.rotation.y = hitter.rotation.y;
        // Open while rising, shut at 1.2 s, then chewing.
        const shut = clamp((T - 1.0) / 0.25, 0, 1);
        jaw.rotation.x = -1.1 * (1 - shut) - (T > 1.25 && T < 3.2 ? Math.abs(Math.sin(T * 9)) * 0.25 : 0);
        head.rotation.z = T > 1.25 && T < 3.2 ? Math.sin(T * 7) * 0.12 : 0;
        // The player is lifted into the jaws, then gone.
        hitter.visible = T < 1.15;
        if (hitter.visible) hitter.position.y = heightAt(court.x, court.z) + 0.2 + clamp((T - 0.6) / 0.5, 0, 1) * 5;
      }
    }

    // Through a camera: among the people in view, the one nearest the middle of the picture.
    const watch = mode === 'camera' ? taken?.watch : undefined;
    const watched = watch === 'court' ? (court && !progress.referee ? court.hitter.group : null) : watch === 'checkpoint' && !progress.identified ? shooter : null;
    if (watched) {
      const crowd = watch === 'court' ? [watched] : [shooter, ...cp.people];
      let seen: THREE.Object3D | null = null;
      let best = 0.38;
      for (const one of crowd) {
        one.getWorldPosition(vp);
        const a = Math.abs(angDiff(Math.atan2(-(vp.x - pos.x), -(vp.z - pos.z)), heading));
        if (a < best) {
          best = a;
          seen = one;
        }
      }
      const found = seen === watched;
      idTime = found ? idTime + dt : Math.max(0, idTime - dt * 2);
      const what = watch === 'court' ? t('player', 'giocatore') : t('weapon', 'arma');
      if (seen) {
        seen.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(seen);
        const conf = Math.min(0.99, 0.45 + idTime * 0.35);
        placeBox(box, found ? (conf >= 0.99 ? `${what} · ${t('identified', 'identificato')}` : `${what} ${conf.toFixed(2)}`) : `${t('person', 'persona')} ${(0.8 + (seen.id % 7) / 50).toFixed(2)}`, found && conf >= 0.99);
      } else detect.hidden = true;
      if (idTime > 1.6) {
        idTime = 0;
        if (watch === 'court') {
          progress.referee = true;
          courtAt = time;
          toast(t('Player identified and sent off… by a carnivorous plant! The court is clear.', 'Giocatore identificato ed espulso… da una pianta carnivora! Il campo è libero.'));
        } else {
          progress.identified = true;
          guardAt = time;
          toast(t('Weapon identified! The police are on their way.', 'Arma identificata! Arriva la polizia.'));
        }
        saveProgress();
      }
    } else if (mode === 'camera') detect.hidden = true;

    // Litter: solid for everyone, except the robot, which clears it.
    for (const pile of litter) {
      if (!pile.object.visible || pile.object.userData.clearAt !== undefined || fixed || (flying && pos.y > heightAt(pile.x, pile.z) + 4)) continue;
      const dx = pos.x - pile.x;
      const dz = pos.z - pile.z;
      const d = Math.hypot(dx, dz);
      if (mode === 'robot' && d < pile.r + 2.4) {
        pile.object.userData.clearAt = time;
        continue;
      }
      const min = pile.r + (flying ? 1.2 : mode === 'ghost' ? 0.8 : 0.9 * rigScale);
      if (d < min) {
        const k = d > 0.01 ? min / d : 1;
        pos.x = pile.x + dx * k;
        pos.z = pile.z + dz * k;
        if (!flying) spd *= 0.6;
        if (mode !== 'robot' && !flying) warn(t('Litter blocks the gorge. The litter robot can clear it.', 'La spazzatura chiude la gola. Il robot spazzino può liberarla.'));
      }
    }
    for (const pile of litter) {
      const at = pile.object.userData.clearAt as number | undefined;
      if (at === undefined || !pile.object.visible) continue;
      const f = (time - at) / 0.7;
      pile.object.scale.setScalar(1.5 * Math.max(0, 1 - f));
      if (f >= 1) {
        pile.object.visible = false;
        if (!litter.some((other) => other.object.visible)) {
          progress.litter = true;
          saveProgress();
          toast(t('The gorge is clear: the road to the harbour is open.', 'La gola è libera: la strada per il porto è aperta.'));
        }
      }
    }

    // Where the visitor is now.
    const zoneNow = zoneOf(pos.x, pos.z);
    if (zoneNow !== 'sea' || mode === 'boat' || mode === 'drone') here = zoneNow;
    if (mode !== 'drone') enterZone(here);

    // Roofs: the drone flies under them or lands on top, and the walls of the entablature are solid.
    const roof = roofAt(pos.x, pos.z);
    if (flying && roof) {
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

    if (mode === 'ghost') {
      // Floats a little above the ground, bobbing, leaning into the walk.
      const share = clamp(spd / spec.top, -1, 1);
      ghost.position.set(pos.x, pos.y + 0.35 + (reduced ? 0 : Math.sin(time * 2.4) * 0.12), pos.z);
      (ghost.userData.update as (t: number) => void)(time);
      ghost.rotation.set(share * 0.18, heading + Math.PI, -turn * 0.1 + (reduced ? 0 : Math.sin(time * 1.3) * 0.04));
    } else if (mode === 'motor' || mode === 'camera') {
      // Nothing moves: the motor's shaft spins, the camera pans.
    } else if (mode === 'drone') {
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
      const rig = rigs[mode]!;
      const share = clamp(spd / spec.top, -1, 1);
      if (mode === 'robot') (rig.userData.head as THREE.Object3D).rotation.y = turn * 0.6;
      if (mode === 'boat') {
        pos.y = 0;
        rig.position.set(pos.x, reduced ? 0 : Math.sin(time * 1.3) * 0.12, pos.z);
        rig.rotation.set(Math.sin(time * 0.9) * 0.04 - share * 0.08, heading + Math.PI, Math.sin(time * 0.7) * 0.05 - turn * share * 0.1);
      } else {
        if (!jump) pos.y = heightAt(pos.x, pos.z);
        const reach = 1.2 * rigScale;
        const ahead = heightAt(pos.x + forward.x * reach, pos.z + forward.z * reach);
        const behind = heightAt(pos.x - forward.x * reach, pos.z - forward.z * reach);
        rig.position.set(pos.x, pos.y + 0.06, pos.z);
        const lean = mode === 'bike' ? -turn * Math.abs(share) * 0.45 : turn * Math.abs(share) * 0.05;
        const pitch = jump ? lerp(-0.3, 0.3, jump.t / JUMP_TIME) : -Math.atan2(ahead - behind, reach * 2);
        rig.rotation.set(pitch, heading + Math.PI, lean);
      }
    }

    // Camera: follows behind, eases back after a drag.
    if (!pointers.size && (Math.abs(fwd) > 0.1 || autopilot)) camYaw = lerp(camYaw, 0, 1 - Math.exp(-1.5 * dt));
    const yaw = heading + camYaw;
    // Under a roof the camera comes closer and stays below the ceiling.
    const indoors = roof && pos.y < roof.ceiling ? roof : null;
    const dist = indoors ? Math.min(camDist, 10) : Math.min(camDist, 46);
    desired.set(pos.x + Math.sin(yaw) * Math.cos(camPitch) * dist, pos.y + Math.sin(camPitch) * dist + 1, pos.z + Math.cos(yaw) * Math.cos(camPitch) * dist);
    desired.y = Math.max(desired.y, Math.max(heightAt(desired.x, desired.z), 0) + 1.2);
    if (indoors) desired.y = Math.min(desired.y, indoors.ceiling - 0.6);
    if (first) {
      camPos.copy(desired);
      camLook.copy(pos);
      first = false;
    }
    // The camera zooms in, so the faces on the road are large enough to tell apart.
    const fov = mode === 'camera' ? CAMERA_FOV : baseFov;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (mode === 'camera') {
      // Through the lens.
      camPos.copy(pos);
      camLook.set(pos.x - Math.sin(heading) * 20, pos.y - 4, pos.z - Math.cos(heading) * 20);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    } else {
      camPos.lerp(desired, 1 - Math.exp(-6 * dt));
      camLook.lerp(pos, 1 - Math.exp(-10 * dt));
      camera.position.copy(camPos);
      camera.lookAt(camLook.x, camLook.y + 1, camLook.z);
    }
    // An explosion shakes the view, less the farther it is.
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake = Math.max(0, shake - dt * 2.2);
    }

    // The ring where the ghost went into a machine or came out of it.
    if (poof.visible) {
      const f = (time - poofAt) / 0.6;
      poof.visible = f < 1;
      poof.scale.setScalar(1 + f * 3);
      (poof.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - f);
    }

    // The shadow camera follows the visitor.
    const snapX = Math.round(pos.x / 2) * 2;
    const snapZ = Math.round(pos.z / 2) * 2;
    sun.target.position.set(snapX, 0, snapZ);
    sun.position.copy(SUN_DIR).multiplyScalar(160).add(sun.target.position);

    // Detection.
    const found = playing && mode !== 'camera' ? findTarget() : null;
    if (found !== target) {
      // Moving on: the page of the place left behind closes by itself.
      if (target && sheetOpen === target.def.id) closeSheet();
      target = found;
      lockTime = 0;
      tried = null;
      card.hidden = true;
    }
    if (target) {
      lockTime += dt;
      const confidence = Math.min(0.99, 0.55 + (lockTime / LOCK_SECONDS) * 0.44);
      placeBox(target.bounds, `${target.def.tag} ${confidence.toFixed(2)}`, confidence >= 0.99);
      // Once the detector locks on, the place is known and its card shows; the visitor keeps moving.
      if (confidence >= 0.99) {
        if (tried !== target.def.id) {
          tried = target.def.id;
          onOpen(target.def.id);
        }
        showCard(target);
      }
    } else if (mode !== 'camera') detect.hidden = true;
    if (!target || mode === 'camera') card.hidden = true;

    updateCharges(dt);
    updateTasks();
    updateShield();
    updateChargeBar();

    // Dust behind a machine on the move, spray behind the boat: more of it the faster it goes.
    if ((mode === 'car' || mode === 'bike' || mode === 'robot' || mode === 'boat') && !jump && Math.abs(spd) > 3) {
      dustClock += dt * Math.abs(spd);
      const back = 1.4 * rigScale * Math.sign(spd);
      while (dustClock > 1.8) {
        dustClock -= 1.8;
        const x = pos.x - forward.x * back;
        const z = pos.z - forward.z * back;
        if (mode === 'boat') dust.emit(x, 0.25, z, SPRAY, 1.6, 1.8);
        else dust.emit(x, heightAt(x, z) + 0.25, z, DUST, 0.8 * rigScale, 1.3);
      }
    }

    // The arrow over the objective, hidden once the visitor is there.
    guide.visible = playing && !!goal.at && mode !== 'camera' && Math.hypot(goal.at.x - pos.x, goal.at.z - pos.z) > 14;
    if (guide.visible && goal.at) {
      const ground = Math.max(heightAt(goal.at.x, goal.at.z), 0);
      guide.position.set(goal.at.x, ground + 9 + (reduced ? 0 : Math.sin(time * 2.5) * 0.8), goal.at.z);
      guide.rotation.y = time * 1.2;
      // Larger the farther it is, so it can be seen from across the island.
      guide.scale.setScalar(clamp(Math.hypot(goal.at.x - pos.x, goal.at.z - pos.z) / 40, 1, 4));
    }

    hudTimer += dt;
    if (hudTimer > 0.2) {
      hudTimer = 0;
      updateObjective();
      measureTop();
      statsEl.textContent =
        mode === 'motor'
          ? `RPM ${Math.round(rpm * 3000)} · CHARGE ${Math.round(charge * 100)}%`
          : `${mode === 'drone' ? `ALT ${Math.round(pos.y - Math.max(heightAt(pos.x, pos.z), 0))} m · ` : ''}SPD ${Math.round(Math.hypot(speed, vy))} m/s`;
      const m = playing ? nearbyMachine() : null;
      const label = mode !== 'ghost' ? t(`Leave ${THE[mode]()}`, `Lascia ${THE[mode]()}`) : m ? t(`Possess ${THE[m.kind]()}`, `Possiedi ${THE[m.kind]()}`) : '';
      rideEl.hidden = !playing || !label;
      rideLabel.textContent = label;
    }
    mapTimer += dt;
    if (mapTimer > 1 / 20) {
      mapTimer = 0;
      drawMap();
    }
  }

  let frames = 0;
  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 1 / 10);
    last = now;
    time += dt;
    if (!document.hidden) tune(dt);
    step(dt);
    world.update(reduced ? time * 0.4 : time);
    dust.update(dt);
    renderer.shadowMap.needsUpdate = frames++ % 2 === 0;
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.body.classList.add('is-ready');

  // Deep link: /play/#<place> takes the visitor there.
  const hash = decodeURIComponent(location.hash.slice(1));
  const linked = hash && sites.find((s) => s.def.id === hash);
  if (linked) go(linked);
}
