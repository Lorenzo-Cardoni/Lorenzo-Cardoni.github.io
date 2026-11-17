import experience from '../data/experience.json';
import background from '../data/background.json';

export type TimelineKind = 'work' | 'education' | 'other';

export interface TimelineItem {
  kind: TimelineKind;
  /** Short category shown next to the organisation, e.g. "Work". */
  kindLabel: string;
  title: string;
  org: string;
  /** The period exactly as written in the data files. */
  period: string;
  /** First month, counted as year * 12 + month index. */
  start: number;
  /** Month after the last one (exclusive). */
  end: number;
  ongoing: boolean;
  /** Anchor of the detailed entry further down the page. */
  href: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Stable id for an entry, shared by the timeline row and the detailed entry it links to. */
export function anchorId(prefix: string, text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}-${slug}`;
}

/** "Sep 2024" -> first and last month of that date; "2024" covers the whole year. */
function parseDate(text: string): { first: number; last: number } | null {
  const match = text.trim().match(/^(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{4})$/);
  if (!match) return null;
  const year = Number(match[2]);
  if (!match[1]) return { first: year * 12, last: year * 12 + 11 };
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  return { first: year * 12 + month, last: year * 12 + month };
}

/**
 * Reads the period strings used in the data files:
 * "Apr 2025 – Oct 2025", "Apr 2026 – Present", "Mar 2024" or "2024".
 */
export function parsePeriod(period: string, now: Date): { start: number; end: number; ongoing: boolean } | null {
  const [from, to] = period.split(/\s+[–—-]\s+/);
  const first = parseDate(from);
  if (!first) return null;

  if (to === undefined) return { start: first.first, end: first.last + 1, ongoing: false };

  if (/^(present|now|today)$/i.test(to.trim())) {
    const current = now.getFullYear() * 12 + now.getMonth();
    return { start: first.first, end: Math.max(current, first.first) + 1, ongoing: true };
  }

  const last = parseDate(to);
  if (!last) return null;
  return { start: first.first, end: last.last + 1, ongoing: false };
}

/** Every dated activity on the site, most recent first. */
export function buildTimeline(now: Date = new Date()): TimelineItem[] {
  const items: TimelineItem[] = [];

  const add = (entry: Omit<TimelineItem, 'start' | 'end' | 'ongoing'>) => {
    const span = parsePeriod(entry.period, now);
    if (!span) {
      console.warn(`[timeline] Skipped "${entry.title}": cannot read the period "${entry.period}"`);
      return;
    }
    items.push({ ...entry, ...span });
  };

  for (const job of experience) {
    add({
      kind: 'work',
      kindLabel: 'Work',
      title: job.role,
      org: job.company,
      period: job.period,
      href: `#${anchorId('work', job.company)}`,
    });
  }

  for (const degree of background.education) {
    add({
      kind: 'education',
      kindLabel: 'Education',
      title: degree.degree,
      org: degree.school,
      period: degree.period,
      href: `#${anchorId('degree', degree.degree)}`,
    });
  }

  for (const challenge of background.challenges) {
    add({
      kind: 'other',
      kindLabel: 'Competition',
      title: challenge.title,
      org: '',
      period: challenge.period,
      href: `#${anchorId('competition', challenge.title)}`,
    });
  }

  for (const pub of background.publications) {
    add({
      kind: 'other',
      kindLabel: 'Publication',
      title: pub.shortTitle || pub.title,
      org: pub.venueShort || pub.venue,
      period: pub.date,
      href: `#${anchorId('paper', pub.doi)}`,
    });
  }

  return items.sort((a, b) => b.start - a.start || b.end - a.end);
}
