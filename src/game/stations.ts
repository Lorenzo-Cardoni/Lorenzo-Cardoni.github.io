// Turns the site's data files into the places of the 3D world. Runs at build time only: the page
// prints the text of every entry as HTML and hands the game a small list of positions.
//
// Dated entries line up along the timeline road in chronological order, so a new job or project
// added to the data files finds its own place. Entries the table below does not know get a
// generic building.
import profile from '../data/profile.json';
import experience from '../data/experience.json';
import background from '../data/background.json';
import projects from '../data/projects.json';
import skills from '../data/skills.json';
import { anchorId, parsePeriod } from '../utils/timeline';
import { videos } from '../utils/videos';
import { LIGHTHOUSE_R, ROAD_HALF, bearingOf, coastRadius, mainAt, mainRoad, polar, rad } from './layout';
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
  paper: 6,
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
  museum: 18.5,
};

/** How much each model is enlarged; the rest use DEFAULT_SCALE. */
const SCALE: Record<string, number> = { pad: 1.35, exhibit: 1.3, lighthouse: 1.5 };
const DEFAULT_SCALE = 1.6;

/** Where the data science hall stands on the avenue, south of the landing pad. */
const MUSEUM_Z = 96;

/**
 * Entries with a model of their own, matched on their name. Anything else falls back by category.
 * - `near` moves an entry next to another one (on the timeline road, the two share a spot).
 * - `museum` puts a side project inside the data science hall.
 * - `group` limits the match to one group, for an organisation that is both a workplace and a school.
 * - `logo` is a file in src/assets/logos/ shown on the board in front of the place; when the file
 *   is missing the board shows `org` (or the entry's name) as text.
 * - `board: false` leaves out the board of a workplace whose organisation has one elsewhere.
 */
interface Known {
  test: RegExp;
  group?: Group;
  model: string;
  tag?: string;
  near?: RegExp;
  museum?: boolean;
  logo?: string;
  org?: string;
  board?: false;
}

const KNOWN: Known[] = [
  { test: /inim/i, model: 'office', logo: 'inim.png' },
  { test: /filo d.oro/i, model: 'residential', tag: 'lega_del_filo_doro', logo: 'lega-del-filo-doro.jpg' },
  { test: /pieralisi/i, model: 'factory', logo: 'pieralisi.jpg' },
  // The lab job stands by the GeoPosBall it tested; the UNIVPM board is at the campus.
  { test: /politecnica/i, group: 'work', model: 'lab', tag: 'univpm_lab', near: /geoposball/i, board: false },
  { test: /politecnica/i, group: 'study', model: 'campus', tag: 'univpm_campus', logo: 'logo-univpm.webp' },
  { test: /^data science/i, model: 'museum', tag: 'data_science_hall' },
  { test: /yolov8|benchmark/i, model: 'paper', near: /super-resolution/i },
  { test: /bosch/i, model: 'circuit', tag: 'bosch_challenge' },
  { test: /hackathon 2024/i, model: 'robot', tag: 'hackathon_2024' },
  { test: /hackathon/i, model: 'tent' },
  { test: /uav|drone/i, model: 'hangar', tag: 'uav_fault_diagnosis' },
  { test: /super-resolution/i, model: 'pixelwall', tag: 'super_resolution' },
  { test: /geoposball/i, model: 'buoys', tag: 'geoposball' },
  { test: /volleyball/i, model: 'court', tag: 'volleyball_detection' },
  { test: /e-bike/i, model: 'biketrack', tag: 'autonomous_ebike' },
  { test: /cnn/i, model: 'exhibit:chip', tag: 'cnn_on_stm32', near: /e-bike/i },
  { test: /heart/i, model: 'exhibit:clusters', tag: 'heart_risk_ml', museum: true },
  { test: /forecast/i, model: 'exhibit:chart', tag: 'temp_forecast', museum: true },
  { test: /chatbot/i, model: 'exhibit:chat', tag: 'game_chatbot', museum: true },
  { test: /network/i, model: 'exhibit:graph', tag: 'network_analysis', museum: true },
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
  slot: 'road' | 'free' | 'avenue' | 'home' | 'skills' | 'lighthouse' | 'museum' | 'hall';
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

  list.push({
    id: 'profile',
    group: 'profile',
    name: profile.name,
    sub: profile.jobTitle,
    fallback: 'pad',
    slot: 'home',
    tag: snake(profile.jobTitle),
    entry: {
      ...emptyEntry(),
      kicker: `Profile · ${profile.location}`,
      title: profile.name,
      sub: profile.headline,
      text: profile.about,
      facts: profile.status,
      links: [
        { label: 'Download CV', href: profile.resumeUrl, external: true, style: 'btn', icon: 'download' },
        { label: 'Read the classic page', href: '/', style: 'link' },
      ],
    },
  });

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

  for (const pub of background.publications) {
    list.push({
      id: anchorId('paper', pub.doi),
      group: 'study',
      name: pub.shortTitle || pub.title,
      sub: pub.venueShort || pub.venue,
      fallback: 'paper',
      slot: 'road',
      when: monthOf(pub.date),
      tag: snake(`paper ${pub.venueShort || ''}`, 4),
      entry: {
        ...emptyEntry(),
        kicker: `Publication · ${pub.date}`,
        title: pub.title,
        sub: pub.venue,
        text: [pub.authors.join(', ')],
        links: [
          { label: `DOI ${pub.doi}`, href: `https://doi.org/${pub.doi}`, external: true, style: 'link' },
          onPage(anchorId('paper', pub.doi)),
        ],
      },
    });
  }

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

  list.push({
    id: 'skills',
    group: 'skills',
    name: 'Skills',
    sub: `${skills.reduce((n, g) => n + g.skills.length, 0)} tools in ${skills.length} groups`,
    fallback: 'pylons',
    slot: 'skills',
    tag: 'toolkit',
    extra: skills.map((g) => g.skills.length),
    icons: skills.map((g) => g.skills.map(toolIcon)),
    entry: {
      ...emptyEntry(),
      kicker: 'Skills',
      title: 'Tools I work with.',
      lists: [
        ...skills.map((g) => ({ title: g.title, items: g.skills })),
        { title: 'Languages', items: background.languages.map((l) => `${l.name} (${l.level})`) },
      ],
      links: [onPage('skills')],
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

  // Side projects of the MSc data science courses go inside one hall, which is a place of its own.
  const museum = list.filter((seed) => modelFor(seed).known?.museum);
  if (museum.length) {
    for (const seed of museum) {
      seed.slot = 'museum';
      seed.sub = 'MSc project · Data science';
      seed.entry.kicker = 'MSc project · Data science';
    }
    list.push({
      id: 'data-science-hall',
      group: 'project',
      name: 'Data science hall',
      sub: `${museum.length} MSc projects inside`,
      fallback: 'museum',
      slot: 'hall',
      entry: {
        ...emptyEntry(),
        kicker: 'MSc · Data science',
        title: 'Data science hall',
        text: [
          'Projects from the data science courses of my MSc in Computer and Automation Engineering. Fly or drive in through the colonnade: each one stands on its own plinth.',
        ],
        lists: [{ title: 'Inside', items: museum.map((seed) => seed.name) }],
        tags: [...new Set(museum.flatMap((seed) => seed.entry.tags))],
        links: [onPage('projects')],
      },
    });
  }

  return list;
}

// ---------- Placement ----------

/** Rotation that turns a model's front (+z) toward a target point. */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** Spots inside the ring for featured projects without a year. */
const FREE_SLOTS = [rad(270), rad(300), rad(62), rad(96)];

export function buildWorld(): World {
  const all = seeds();
  const stations: Station[] = [];
  const gates: Gate[] = [];

  const place = (seed: Seed, x: number, z: number, yaw: number, sea = false, inside?: string) => {
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

  // `near`: the place it should stand next to, when that one exists.
  const partnerOf = (seed: Seed) => {
    const near = modelFor(seed).known?.near;
    return near ? all.find((other) => other !== seed && near.test(other.name)) : undefined;
  };

  // Dated entries: evenly spaced along the ring in chronological order, on alternating sides.
  // An entry with a `near` partner shares the partner's spot, on the other side of the road.
  // The side is counted back from the last spot, which sits outside, clear of the road's final curl.
  const roadSeeds = all.filter((s) => s.slot === 'road' && s.when !== undefined);
  const onRoad = (seed?: Seed) => !!seed && roadSeeds.includes(seed);
  const hosts = roadSeeds.filter((s) => !onRoad(partnerOf(s))).sort((a, b) => a.when! - b.when!);
  const guests = new Map<Seed, Seed[]>();
  for (const seed of roadSeeds) {
    const host = partnerOf(seed);
    if (onRoad(host)) guests.set(host!, [...(guests.get(host!) ?? []), seed]);
  }
  // Entries that stand next to a place off the road are placed last, once their partner is.
  const later = all.filter((s) => !onRoad(s) && s.slot !== 'museum' && partnerOf(s));

  const spacing = mainRoad.ringLength / Math.max(hosts.length, 1);
  const isSea = (seed: Seed) => modelFor(seed).model === 'buoys';
  const onLand = hosts.filter((s) => !isSea(s)).length;

  const yearGate = (s: number, label: string) => {
    const p = mainAt(s);
    gates.push({ x: p.x, z: p.z, yaw: Math.PI / 2 - bearingOf(p.x, p.z), label });
  };

  let land = 0;
  hosts.forEach((seed, i) => {
    const year = Math.floor(seed.when! / 12);
    if (i === 0) yearGate(2, String(year));
    else if (year !== Math.floor(hosts[i - 1].when! / 12)) yearGate(i * spacing, String(year));

    const p = mainAt((i + 0.5) * spacing);
    const b = bearingOf(p.x, p.z);
    const beside = (other: Seed, outside: boolean, along = 0) => {
      const { r } = modelFor(other);
      const q = mainAt((i + 0.5) * spacing + along);
      const qb = bearingOf(q.x, q.z);
      const at = polar(qb, Math.hypot(q.x, q.z) + (outside ? 1 : -1) * (ROAD_HALF + 6 + r));
      place(other, at.x, at.z, facing(at.x, at.z, q.x, q.z));
    };

    if (isSea(seed)) {
      // At sea, with its companions on the shore in front of it.
      const at = polar(b, coastRadius(b) + 20);
      place(seed, at.x, at.z, facing(at.x, at.z, 0, 0), true);
      (guests.get(seed) ?? []).forEach((other, j) => {
        const { r } = modelFor(other);
        const shore = polar(b + (j - ((guests.get(seed)?.length ?? 1) - 1) / 2) * 0.12, coastRadius(b) - r - 7);
        place(other, shore.x, shore.z, facing(shore.x, shore.z, at.x, at.z));
      });
      return;
    }
    const outside = (onLand - 1 - land) % 2 === 0;
    land++;
    beside(seed, outside);
    (guests.get(seed) ?? []).forEach((other, j) => beside(other, !outside, j * 12));
  });

  // Featured projects without a year, and dated entries whose date cannot be read: inside the ring.
  const free = all.filter((s) => (s.slot === 'free' || (s.slot === 'road' && s.when === undefined)) && !later.includes(s));
  free.forEach((seed, i) => {
    const b = FREE_SLOTS[i % FREE_SLOTS.length];
    const at = polar(b, 58 - 18 * Math.floor(i / FREE_SLOTS.length));
    place(seed, at.x, at.z, facing(0, 0, at.x, at.z));
  });

  // The data science hall straddles the avenue, its entrance toward the landing pad, and its
  // projects stand inside on two rows of plinths either side of the aisle.
  const hall = all.find((s) => s.slot === 'hall');
  if (hall) {
    const { scale } = modelFor(hall);
    place(hall, 0, MUSEUM_Z, Math.PI);
    const inside = all.filter((s) => s.slot === 'museum');
    const rows = Math.ceil(inside.length / 2);
    inside.forEach((seed, i) => {
      const lx = i % 2 === 0 ? -4.4 : 4.4;
      const lz = rows === 1 ? 0 : -6.5 + (13 * Math.floor(i / 2)) / (rows - 1);
      // Yaw of half a turn: local x and z both flip.
      const x = -lx * scale;
      const z = MUSEUM_Z - lz * scale;
      place(seed, x, z, facing(x, z, 0, z), false, hall.id);
    });
  }

  // Other side projects: along the avenue, between the hall and the lighthouse.
  const side = all.filter((s) => s.slot === 'avenue' && !later.includes(s));
  side.forEach((seed, i) => {
    const x = i % 2 === 0 ? -11 : 11;
    const z = MUSEUM_Z + 42 + i * 16;
    place(seed, x, z, facing(x, z, 0, z));
  });

  for (const seed of all) {
    if (seed.slot === 'home') place(seed, 0, 0, rad(40));
    if (seed.slot === 'skills') {
      const at = polar(rad(0), 52);
      place(seed, at.x, at.z, facing(at.x, at.z, 0, 0));
    }
    if (seed.slot === 'lighthouse') place(seed, 0, LIGHTHOUSE_R, facing(0, LIGHTHOUSE_R, 0, 0));
  }

  for (const seed of later) {
    const host = stations.find((st) => st.id === partnerOf(seed)!.id);
    if (!host) continue;
    const { r } = modelFor(seed);
    // Beside the partner, along the circle around the centre of the island.
    const b = bearingOf(host.x, host.z);
    const d = host.r + r + 6;
    const x = host.x + Math.cos(b) * d;
    const z = host.z + Math.sin(b) * d;
    place(seed, x, z, facing(x, z, 0, 0));
  }

  // Index order: by group, and inside a group as the data files list them.
  const order = new Map(all.map((s, i) => [s.id, i]));
  stations.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

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
