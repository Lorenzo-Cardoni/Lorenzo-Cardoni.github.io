// Turns the site's data files into the places of the 3D world. Runs at build time only: the page
// prints the text of every entry as HTML and hands the game a small list of positions.
//
// The places stand in the zones of the island (see layout.ts): along the timeline road in the four
// zones of the ring, by date, then on the islet and on the mountain. Each known entry names its
// zone in the table below; entries the table does not know get a generic building in the valley.
import profile from '../data/profile.json';
import experience from '../data/experience.json';
import background from '../data/background.json';
import projects from '../data/projects.json';
import skills from '../data/skills.json';
import { anchorId, parsePeriod } from '../utils/timeline';
import { videos } from '../utils/videos';
import { LIGHTHOUSE_R, SIDE, TAU, ZONE_ORDER, isletPoint, ROAD_HALF, bearingOf, coastRadius, mainAt, polar, rad, roadAt, type Zone } from './layout';
import { toolIcon, toolIcons, type ToolIcon } from './icons';

/**
 * Board standing in front of a workplace or a school: its logo (or its name) and the tools used
 * there. Only places that stand for a real site of an organisation get one.
 */
export interface Sign {
  /** File in src/assets/logos/; the page swaps it for the URL of the built image. */
  logo?: string;
  title: string;
  sub: string;
  icons: ToolIcon[];
}

export type Group = 'profile' | 'work' | 'study' | 'project' | 'skills' | 'contact';

/** The zones of the island as the places list shows them, in the order they are reached. */
export const ZONES: { id: Zone; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'plateau', label: 'The plateau' },
  { id: 'valley', label: 'The valley' },
  { id: 'yard', label: 'The yard' },
  { id: 'harbour', label: 'The harbour' },
  { id: 'islet', label: 'The islet' },
  { id: 'mountain', label: 'The mountain' },
];

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'work', label: 'Experience' },
  { id: 'study', label: 'Education and research' },
  { id: 'project', label: 'Projects' },
  { id: 'skills', label: 'Skills' },
  { id: 'contact', label: 'Contact' },
];

/** What the game needs to know about a place. */
export interface StationDef {
  id: string;
  group: Group;
  /** Label the drone's detector prints, in the style of the portrait on the home page. */
  tag: string;
  title: string;
  sub: string;
  /** Which 3D model stands there (see models.ts). */
  model: string;
  /** The zone of the island it stands in; on foot it is visited from that zone. */
  zone: Zone;
  /** Position along the way through the island: places are got to know in this order. */
  order: number;
  x: number;
  z: number;
  /** Radius of the levelled site. */
  r: number;
  /** Rotation that turns the front of the model toward the road. */
  yaw: number;
  sea: boolean;
  extra: number[];
  /** Size of the model: every model is drawn at a base size and enlarged by this factor. */
  scale: number;
  /** Id of the building this place stands inside (the data science hall). */
  inside?: string;
  sign?: Sign;
  /** Skills only: the tools of each group. */
  icons?: ToolIcon[][];
}

export interface EntryLink {
  label: string;
  href: string;
  external?: boolean;
  style: 'btn' | 'ghost' | 'link';
  icon?: string;
}

/** The text of an entry, as shown in the panel. */
export interface Entry {
  kicker: string;
  title: string;
  sub: string;
  text: string[];
  points: string[];
  tags: string[];
  facts: { label: string; value: string }[];
  lists: { title: string; items: string[] }[];
  links: EntryLink[];
  image: string;
  imageAlt: string;
}

export interface Station extends StationDef {
  entry: Entry;
}

export interface Gate {
  x: number;
  z: number;
  yaw: number;
  label: string;
}

export interface World {
  stations: Station[];
  gates: Gate[];
}

// ---------- Models ----------

/** Site radius of each model. */
const FOOTPRINT: Record<string, number> = {
  pad: 11,
  office: 11,
  campus: 14,
  residential: 13,
  factory: 11,
  lab: 9,
  hall: 10,
  circuit: 12,
  robot: 6,
  tent: 8,
  hangar: 12,
  pixelwall: 9,
  buoys: 9,
  court: 11,
  biketrack: 9,
  pylons: 10,
  lighthouse: 8,
  block: 9,
  exhibit: 4.5,
};

/** How much each model is enlarged; the rest use DEFAULT_SCALE. */
const SCALE: Record<string, number> = { pad: 1.35, exhibit: 1.3, lighthouse: 1.5 };
const DEFAULT_SCALE = 1.6;

/**
 * Entries with a model of their own, matched on their name. Anything else falls back by category.
 * - `zone` is the zone of the island it stands in (see layout.ts).
 * - `near` moves an entry next to another one of the same zone (across the road from it).
 * - `opener` puts an entry first in its zone, right where the visitor starts, whatever its date.
 * - `side` puts an entry at the end of a side path (see SIDE in layout.ts), off the road.
 * - `museum` marks a side project of the MSc data science courses: they stand together, in the
 *   open, on the plaza of the islet.
 * - `group` limits the match to one group, for an organisation that is both a workplace and a school.
 * - `logo` is a file in src/assets/logos/ shown on the board in front of the place; when the file
 *   is missing the board shows `org` (or the entry's name) as text.
 * - `board: false` leaves out the board of a workplace whose organisation has one elsewhere.
 */
interface Known {
  test: RegExp;
  group?: Group;
  model: string;
  zone?: Zone;
  tag?: string;
  near?: RegExp;
  museum?: boolean;
  opener?: boolean;
  side?: keyof typeof SIDE;
  /** On the mountain: a spot of its own, as a bearing (degrees) and a distance from the centre. */
  spot?: [number, number];
  logo?: string;
  org?: string;
  board?: false;
}

const KNOWN: Known[] = [
  // Start: where the visitor arrives. The e-bike stands right after the university, the first
  // machine the ghost meets; it climbs the ramp to the plateau.
  { test: /politecnica/i, group: 'study', zone: 'start', model: 'campus', tag: 'univpm_campus', logo: 'logo-univpm.webp' },
  { test: /e-bike/i, zone: 'start', model: 'biketrack', tag: 'autonomous_ebike', opener: true },
  // Plateau: the Bosch car jumps the river to the valley, once the tourists of the 2023 hackathon
  // (crowd flow and safety for big events) clear the run-up.
  { test: /bosch/i, zone: 'plateau', model: 'circuit', tag: 'bosch_challenge' },
  { test: /hackathon 2023/i, zone: 'plateau', model: 'tent', side: 'tent' },
  // Valley: the super-resolution project helps identify the guard at the end of it.
  { test: /super-resolution/i, zone: 'valley', model: 'pixelwall', tag: 'super_resolution', side: 'superres' },
  // Yard, past the guard: the litter robot clears the gorge to the harbour.
  { test: /hackathon 2024/i, zone: 'yard', model: 'robot', tag: 'hackathon_2024' },
  { test: /hackathon/i, zone: 'valley', model: 'tent' },
  // Harbour: GeoPosBall turns the GPS (the minimap) on, and its boat crosses to the islet.
  { test: /geoposball/i, zone: 'harbour', model: 'buoys', tag: 'geoposball' },
  // The lab job stands by the GeoPosBall it tested; the UNIVPM board is at the campus.
  { test: /politecnica/i, group: 'work', zone: 'harbour', model: 'lab', tag: 'univpm_lab', near: /geoposball/i, board: false },
  // Islet: the drone vault. The data science projects and the CNN, on the plaza, teach how to fix
  // the drone; the
  // Pieralisi motor charges it.
  { test: /pieralisi/i, zone: 'islet', model: 'factory', logo: 'pieralisi.jpg' },
  { test: /uav|drone/i, zone: 'islet', model: 'hangar', tag: 'drone_vault' },
  { test: /cnn/i, zone: 'islet', model: 'exhibit:chip', tag: 'cnn_on_stm32' },
  { test: /heart/i, model: 'exhibit:clusters', tag: 'heart_risk_ml', museum: true },
  { test: /forecast/i, model: 'exhibit:chart', tag: 'temp_forecast', museum: true },
  { test: /chatbot/i, model: 'exhibit:chat', tag: 'game_chatbot', museum: true },
  { test: /network/i, model: 'exhibit:graph', tag: 'network_analysis', museum: true },
  // Mountain: only the drone gets up there.
  // Inim out on the massif, well away from Lega del Filo d'Oro on the top.
  { test: /inim/i, zone: 'mountain', model: 'office', logo: 'inim.png', spot: [140, 110] },
  { test: /filo d.oro/i, zone: 'mountain', model: 'residential', tag: 'lega_del_filo_doro', logo: 'lega-del-filo-doro.jpg' },
  { test: /volleyball/i, zone: 'mountain', model: 'court', tag: 'volleyball_detection' },
];

function snake(text: string, words = 3): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, words)
    .join('_');
}

function modelFor(seed: { name: string; group: Group; fallback: string }) {
  const known = KNOWN.find((entry) => entry.test.test(seed.name) && (!entry.group || entry.group === seed.group));
  const model = known?.model ?? seed.fallback;
  const base = model.split(':')[0];
  const scale = SCALE[base] ?? DEFAULT_SCALE;
  return { model, tag: known?.tag ?? snake(seed.name), r: (FOOTPRINT[base] ?? 9) * scale, scale, known };
}

// ---------- Entries ----------

const emptyEntry = (): Entry => ({
  kicker: '',
  title: '',
  sub: '',
  text: [],
  points: [],
  tags: [],
  facts: [],
  lists: [],
  links: [],
  image: '',
  imageAlt: '',
});

const onPage = (hash: string): EntryLink => ({ label: 'See it in the portfolio', href: `/#${hash}`, style: 'link' });

interface Seed {
  id: string;
  group: Group;
  name: string;
  sub: string;
  fallback: string;
  entry: Entry;
  /** Sort position on the timeline, in months. Undefined for entries without a date. */
  when?: number;
  slot: 'road' | 'free' | 'avenue' | 'skills' | 'lighthouse' | 'museum';
  tag?: string;
  extra?: number[];
  icons?: ToolIcon[][];
  /** Text for the board in front of the place; no board when missing. */
  sign?: { title: string; sub: string };
}

/** Month an entry starts, or the middle of the year when only a year is given. */
function monthOf(period: string): number | undefined {
  if (!period) return undefined;
  const span = parsePeriod(period, new Date());
  if (!span) return undefined;
  return /^\s*\d{4}\s*$/.test(period) ? span.start + 6 : span.start;
}

function seeds(): Seed[] {
  const list: Seed[] = [];

  for (const job of experience) {
    list.push({
      id: anchorId('work', job.company),
      group: 'work',
      name: job.company,
      sub: job.role,
      fallback: 'block',
      slot: 'road',
      when: monthOf(job.period),
      sign: { title: job.company, sub: `${job.role} · ${job.period}` },
      entry: {
        ...emptyEntry(),
        kicker: `Work · ${job.period}`,
        title: job.company,
        sub: `${job.role} · ${job.type}`,
        text: [job.summary],
        points: job.highlights,
        tags: job.skills,
        links: [onPage(anchorId('work', job.company))],
      },
    });
  }

  // One place per school, holding every degree taken there (the BSc and the MSc share the campus).
  const schools = [...new Set(background.education.map((d) => d.school))];
  for (const school of schools) {
    const degrees = background.education.filter((d) => d.school === school);
    const byStart = [...degrees].sort((a, b) => (monthOf(a.period) ?? 0) - (monthOf(b.period) ?? 0));
    const from = byStart[0].period.split('–')[0].trim();
    const to = byStart[byStart.length - 1].period.split('–').pop()!.trim();
    const period = from === to ? from : `${from} – ${to}`;
    const short = byStart.map((d) => d.degree.replace(/ in .*/, ''));
    const fields = new Set(degrees.map((d) => d.degree.replace(/^.*? in /, '')));
    const sub = fields.size === 1 ? `${short.join(' and ')} in ${[...fields][0]}` : degrees.map((d) => d.degree).join(' · ');
    list.push({
      id: anchorId('school', school),
      group: 'study',
      name: school,
      sub: short.join(' · '),
      fallback: 'hall',
      slot: 'road',
      when: monthOf(byStart[0].period),
      sign: { title: school, sub: `${short.join(' · ')} · ${period}` },
      entry: {
        ...emptyEntry(),
        kicker: `Education · ${period}`,
        title: school,
        sub,
        facts: degrees.flatMap((d) => {
          const level = d.degree.replace(/ in .*/, '');
          return [
            { label: `${level} · ${d.period}`, value: `${d.degree} · ${d.grade}` },
            { label: `${level} thesis`, value: `${d.thesis} (advisor ${d.advisor})` },
          ];
        }),
        links: [onPage('education')],
      },
    });
  }

  // The publications stay on the portfolio page: the island has no place for them.

  for (const challenge of background.challenges) {
    list.push({
      id: anchorId('competition', challenge.title),
      group: 'study',
      name: challenge.title,
      sub: `Competition · ${challenge.period}`,
      fallback: 'tent',
      slot: 'road',
      when: monthOf(challenge.period),
      entry: {
        ...emptyEntry(),
        kicker: `Competition · ${challenge.period}`,
        title: challenge.title,
        text: [challenge.description],
        links: [onPage(anchorId('competition', challenge.title))],
      },
    });
  }

  for (const project of projects.featured) {
    const when = monthOf(project.year);
    const links: EntryLink[] = [];
    if (project.video && videos[project.video]) {
      links.push({ label: 'Watch the video', href: `/videos/${project.video}.mp4`, external: true, style: 'ghost', icon: 'play' });
    }
    if (project.link) links.push({ label: project.linkLabel || 'Repository', href: project.link, external: true, style: 'link' });
    links.push(onPage('projects'));
    list.push({
      id: anchorId('project', project.title),
      group: 'project',
      name: project.title,
      sub: [project.kind, project.year].filter(Boolean).join(' · '),
      fallback: 'exhibit:box',
      slot: when === undefined ? 'free' : 'road',
      when,
      entry: {
        ...emptyEntry(),
        kicker: [project.kind, project.year].filter(Boolean).join(' · '),
        title: project.title,
        text: [project.description],
        points: project.points,
        tags: project.tech,
        image: project.image,
        imageAlt: project.imageAlt,
        links,
      },
    });
  }

  for (const project of projects.more) {
    list.push({
      id: anchorId('project', project.title),
      group: 'project',
      name: project.title,
      sub: 'Side project',
      fallback: 'exhibit:box',
      slot: 'avenue',
      entry: {
        ...emptyEntry(),
        kicker: 'Side project',
        title: project.title,
        text: [project.description],
        tags: project.tech,
        links: [
          ...(project.link ? [{ label: 'Repository', href: project.link, external: true, style: 'link' } as EntryLink] : []),
          onPage('projects'),
        ],
      },
    });
  }

  // The profile and the toolkit are one place: a statue of the AI engineer among the skill masts.
  list.push({
    id: 'profile',
    group: 'profile',
    name: profile.name,
    sub: `${profile.jobTitle} · ${skills.reduce((n, g) => n + g.skills.length, 0)} tools`,
    fallback: 'pylons',
    slot: 'skills',
    tag: snake(profile.jobTitle),
    extra: skills.map((g) => g.skills.length),
    icons: skills.map((g) => g.skills.map(toolIcon)),
    entry: {
      ...emptyEntry(),
      kicker: `Profile · ${profile.location}`,
      title: profile.name,
      sub: profile.headline,
      text: profile.about,
      facts: profile.status,
      lists: [
        ...skills.map((g) => ({ title: g.title, items: g.skills })),
        { title: 'Languages', items: background.languages.map((l) => `${l.name} (${l.level})`) },
      ],
      links: [
        { label: 'Download CV', href: profile.resumeUrl, external: true, style: 'btn', icon: 'download' },
        { label: 'Read the classic page', href: '/', style: 'link' },
      ],
    },
  });

  list.push({
    id: 'contact',
    group: 'contact',
    name: 'Contact',
    sub: profile.email,
    fallback: 'lighthouse',
    slot: 'lighthouse',
    tag: 'get_in_touch',
    entry: {
      ...emptyEntry(),
      kicker: 'Contact',
      title: 'Get in touch.',
      text: ['Email is the fastest way to reach me.'],
      links: [
        { label: profile.email, href: `mailto:${profile.email}`, style: 'btn', icon: 'mail' },
        ...profile.socials.map((s) => ({ label: s.name, href: s.url, external: true, style: 'ghost', icon: s.icon }) as EntryLink),
        { label: 'Download CV', href: profile.resumeUrl, external: true, style: 'ghost', icon: 'download' },
      ],
    },
  });

  // Side projects of the MSc data science courses: together, in the open, on the islet's plaza.
  for (const seed of list.filter((seed) => modelFor(seed).known?.museum)) {
    seed.slot = 'museum';
    seed.sub = 'MSc project · Data science';
    seed.entry.kicker = 'MSc project · Data science';
  }

  return list;
}

// ---------- Placement ----------

/** Rotation that turns a model's front (+z) toward a target point. */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** The stretch of road in each zone of the ring, as bearings in degrees, leaving the obstacles clear. */
const ROAD_ZONES: { zone: Zone; from: number; to: number }[] = [
  // Short, so the e-bike stands right after the university.
  { zone: 'start', from: 206, to: 238 },
  { zone: 'plateau', from: 270, to: 290 },
  { zone: 'yard', from: 358, to: 376 },
  { zone: 'harbour', from: 26, to: 66 },
];

/** Spots on the islet: across (u) and away from the island (v), from its centre. */
const ISLET_SLOTS: Record<string, [number, number]> = {
  factory: [-31, -19],
  hangar: [32, -19],
  chip: [0, -26],
};
/** Spots on the top of the mountain, as bearings in degrees. */
const MOUNTAIN_SLOTS = [300, 60, 180, 240, 0, 120];

export function buildWorld(): World {
  const all = seeds();
  const stations: Station[] = [];
  const gates: Gate[] = [];

  const place = (seed: Seed, zone: Zone, x: number, z: number, yaw: number, sea = false, inside?: string) => {
    const { model, tag, r, scale, known } = modelFor(seed);
    const sign: Sign | undefined = seed.sign && known?.board !== false && {
      logo: known?.logo,
      title: known?.org ?? seed.sign.title,
      sub: seed.sign.sub,
      icons: toolIcons(seed.entry.tags),
    };
    stations.push({
      id: seed.id,
      group: seed.group,
      tag: seed.tag ?? tag,
      title: seed.name,
      sub: seed.sub,
      model,
      zone,
      order: 0,
      x,
      z,
      r,
      yaw,
      sea,
      extra: seed.extra ?? [],
      scale,
      inside,
      sign,
      icons: seed.icons,
      entry: seed.entry,
    });
  };

  /** The zone an entry belongs to: from the table, or by kind of place; unknown entries go to the valley. */
  const zoneFor = (seed: Seed): Zone => {
    const known = modelFor(seed).known;
    if (known?.zone) return known.zone;
    if (seed.slot === 'skills' || seed.slot === 'lighthouse') return 'mountain';
    if (seed.slot === 'museum') return 'islet';
    return 'valley';
  };

  // `near`: the place it should stand next to, when that one exists in the same zone.
  const partnerOf = (seed: Seed) => {
    const near = modelFor(seed).known?.near;
    return near ? all.find((other) => other !== seed && near.test(other.name) && zoneFor(other) === zoneFor(seed)) : undefined;
  };

  // ---------- The ring: four zones along the timeline road ----------
  // In each zone the entries are spread evenly along the road, by date (the `opener` first, those
  // without a date last), on alternating sides. An entry with a `near` partner stands across the
  // road from it; next to a place at sea, it stands on the shore in front of it.

  const firstDate = Math.min(...all.filter((s) => s.when !== undefined).map((s) => s.when!));
  const sortKey = (s: Seed) => (modelFor(s).known?.opener ? firstDate + 0.01 : (s.when ?? Infinity));
  const isSea = (seed: Seed) => modelFor(seed).model === 'buoys';
  let lastYear: number | undefined;

  for (const { zone, from, to } of ROAD_ZONES) {
    const members = all.filter((s) => s.slot !== 'museum' && s.slot !== 'lighthouse' && !modelFor(s).known?.side && zoneFor(s) === zone);
    const guestOf = new Map<Seed, Seed[]>();
    const hosts: Seed[] = [];
    for (const seed of members) {
      const host = partnerOf(seed);
      if (host && members.includes(host) && !partnerOf(host)) guestOf.set(host, [...(guestOf.get(host) ?? []), seed]);
      else hosts.push(seed);
    }
    hosts.sort((a, b) => sortKey(a) - sortKey(b));
    const s0 = roadAt(from);
    const s1 = roadAt(to);
    const step = (s1 - s0) / Math.max(hosts.length, 1);

    let land = 0;
    hosts.forEach((seed, i) => {
      const s = s0 + (i + 0.5) * step;
      if (seed.when !== undefined) {
        const year = Math.floor(sortKey(seed) / 12);
        if (year !== lastYear) {
          const g = mainAt(lastYear === undefined ? 2 : Math.max(s0 + 2, s - step / 2));
          gates.push({ x: g.x, z: g.z, yaw: Math.PI / 2 - bearingOf(g.x, g.z), label: String(year) });
          lastYear = year;
        }
      }
      const p = mainAt(s);
      const b = bearingOf(p.x, p.z);
      const beside = (other: Seed, outside: boolean, along = 0) => {
        const { r } = modelFor(other);
        const q = mainAt(s + along);
        const at = polar(bearingOf(q.x, q.z), Math.hypot(q.x, q.z) + (outside ? 1 : -1) * (ROAD_HALF + 6 + r));
        place(other, zone, at.x, at.z, facing(at.x, at.z, q.x, q.z));
      };

      if (isSea(seed)) {
        const at = polar(b, coastRadius(b) + 20);
        place(seed, zone, at.x, at.z, facing(at.x, at.z, 0, 0), true);
        const companions = guestOf.get(seed) ?? [];
        companions.forEach((other, j) => {
          const { r } = modelFor(other);
          const shore = polar(b + (j - (companions.length - 1) / 2) * 0.12, coastRadius(b) - r - 7);
          place(other, zone, shore.x, shore.z, facing(shore.x, shore.z, at.x, at.z));
        });
        return;
      }
      // The first place of each zone stands on the inside, toward the mountain.
      const outside = land % 2 === 1;
      land++;
      beside(seed, outside);
      (guestOf.get(seed) ?? []).forEach((other, j) => beside(other, !outside, j * 12));
    });
  }

  // ---------- Off the road, down the side paths ----------

  for (const seed of all) {
    const side = modelFor(seed).known?.side;
    if (!side) continue;
    const { at, branch } = SIDE[side];
    const from = mainAt(roadAt(branch));
    place(seed, zoneFor(seed), at.x, at.z, facing(at.x, at.z, from.x, from.z));
  }

  // ---------- The islet ----------

  // The motor's factory and the drone's vault at the sides; between them, a plaza in the open with
  // the CNN and the data science projects, each on its plinth, in a ring.
  const plaza = all.filter((s) => zoneFor(s) === 'islet' && modelFor(s).model.startsWith('exhibit'));
  const centre = isletPoint(0, 12);
  plaza.forEach((seed, i) => {
    const a = (i / plaza.length) * TAU + Math.PI;
    const at = { x: centre.x + Math.sin(a) * 15, z: centre.z - Math.cos(a) * 15 };
    place(seed, 'islet', at.x, at.z, facing(at.x, at.z, centre.x, centre.z));
  });
  const used = new Set<string>();
  let spare = 0;
  for (const seed of all.filter((s) => zoneFor(s) === 'islet' && !plaza.includes(s))) {
    const base = modelFor(seed).model;
    let slot = ISLET_SLOTS[base];
    if (!slot || used.has(base)) slot = [-12 + 24 * (spare++ % 2), 40];
    used.add(base);
    const at = isletPoint(slot[0], slot[1]);
    const toward = isletPoint(0, -40);
    place(seed, 'islet', at.x, at.z, facing(at.x, at.z, toward.x, toward.z));
  }

  // ---------- The mountain ----------

  all
    .filter((s) => s.slot !== 'lighthouse' && s.slot !== 'skills' && zoneFor(s) === 'mountain')
    .sort((a, b) => sortKey(a) - sortKey(b))
    .forEach((seed, i) => {
      const spot = modelFor(seed).known?.spot;
      const at = spot ? polar(rad(spot[0]), spot[1]) : polar(rad(MOUNTAIN_SLOTS[i % MOUNTAIN_SLOTS.length]), 36);
      place(seed, 'mountain', at.x, at.z, facing(at.x, at.z, 0, 0));
    });
  // On the way out to the cape, the last stop before the lighthouse: the profile among the skills.
  for (const seed of all) {
    if (seed.slot !== 'skills') continue;
    const at = polar(Math.PI, 108);
    place(seed, 'mountain', at.x, at.z, facing(at.x, at.z, 0, LIGHTHOUSE_R));
  }
  for (const seed of all) {
    if (seed.slot === 'lighthouse') place(seed, 'mountain', 0, LIGHTHOUSE_R, facing(0, LIGHTHOUSE_R, 0, 0));
  }

  // The order of the way, a suggested route for the places list: by zone, then as placed along it.
  // On the islet: the motor, the CNN, the data science projects, and the drone's vault last.
  const ISLET_RANK: Record<string, number> = { factory: 0, 'exhibit:chip': 1, hangar: 4 };
  const placed = new Map(stations.map((st, i) => [st.id, i]));
  const rank = (st: Station) => (st.zone === 'islet' ? (ISLET_RANK[st.model] ?? 2) * 100 + placed.get(st.id)! : placed.get(st.id)!);
  stations.sort((a, b) => ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone) || rank(a) - rank(b));
  stations.forEach((st, i) => (st.order = i));

  return { stations, gates };
}

/**
 * The part of the world the game script reads: positions, labels and boards, without the entry
 * text. `logoUrl` turns a logo file name into the URL of the built image, or undefined if missing.
 */
export function clientData(world: World, logoUrl: (file: string) => string | undefined): { stations: StationDef[]; gates: Gate[] } {
  return {
    stations: world.stations.map(({ entry: _entry, ...def }) => ({
      ...def,
      x: Math.round(def.x * 100) / 100,
      z: Math.round(def.z * 100) / 100,
      sign: def.sign && { ...def.sign, logo: def.sign.logo ? logoUrl(def.sign.logo) : undefined },
    })),
    gates: world.gates,
  };
}
