// Tool logos for the island, from the simple-icons set (CC0). Runs at build time only: the page
// hands the game the SVG path of each icon, so the icon set itself never reaches the browser.
import * as icons from 'simple-icons';

export interface ToolIcon {
  /** The tool's name as written in the data files. */
  title: string;
  /** SVG path on a 24×24 grid, or empty when the tool has no icon (it is then drawn as text). */
  path: string;
  hex: string;
}

const all = Object.values(icons) as { title: string; slug: string; path: string; hex: string }[];

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');

/** Names in the data files that go by another name in the icon set. */
const ALIASES: [RegExp, string][] = [
  [/^yolo/i, 'ultralytics'],
  [/^stm32/i, 'stmicroelectronics'],
  [/^esp32/i, 'espressif'],
  [/^c\s*\/\s*c\+\+$|^c\+\+$/i, 'cplusplus'],
];

const bySlug = new Map(all.map((icon) => [icon.slug, icon]));
const byTitle = new Map(all.map((icon) => [norm(icon.title), icon]));

export function toolIcon(name: string): ToolIcon {
  const alias = ALIASES.find(([test]) => test.test(name.trim()))?.[1];
  const candidates = [alias, ...name.split('/').map(norm), norm(name)].filter(Boolean) as string[];
  for (const key of candidates) {
    const icon = bySlug.get(key) ?? byTitle.get(key);
    if (icon) return { title: name, path: icon.path, hex: `#${icon.hex}` };
  }
  return { title: name, path: '', hex: '' };
}

/** Icons for a list of tools, those with a logo first, at most `max`. */
export function toolIcons(names: string[], max = 6): ToolIcon[] {
  const list = names.map(toolIcon);
  return [...list.filter((i) => i.path), ...list.filter((i) => !i.path)].slice(0, max);
}
