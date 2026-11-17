// English or Italian for the game: the visitor picks one with the language button, the choice is
// kept in the browser, and the first visit is in Italian. Texts in the code come
// in pairs, `t(english, italian)`; the page's own texts carry their Italian in `data-it`
// (plain text), `data-it-html` (with markup) or `data-it-aria` (an aria-label), and the English
// stays in the markup. The entries of the places come from the portfolio's data files, in English.

export type Lang = 'en' | 'it';
const STORE = 'island-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved === 'en' || saved === 'it') return saved;
  } catch {
    // Storage unavailable: the default below.
  }
  // Italian unless the visitor picked English with the language button.
  return 'it';
}

export let lang: Lang = detect();

/** The text in the current language. */
export const t = (en: string, it: string): string => (lang === 'it' ? it : en);

const listeners: (() => void)[] = [];
/** Called again whenever the language changes, and once right away. */
export function onLang(listener: () => void): void {
  listeners.push(listener);
  listener();
}

/** Puts the page's own texts in the current language. */
function applyPage() {
  document.documentElement.lang = lang;
  for (const [attr, set] of [
    ['it', (el: HTMLElement, v: string) => (el.textContent = v)],
    ['itHtml', (el: HTMLElement, v: string) => (el.innerHTML = v)],
    ['itAria', (el: HTMLElement, v: string) => el.setAttribute('aria-label', v)],
  ] as const) {
    const selector = `[data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const keep = `en${attr[0].toUpperCase()}${attr.slice(1)}`;
      // The English is the markup itself: kept aside the first time.
      if (el.dataset[keep] === undefined) {
        el.dataset[keep] = attr === 'itAria' ? (el.getAttribute('aria-label') ?? '') : attr === 'itHtml' ? el.innerHTML : (el.textContent ?? '');
      }
      set(el, lang === 'it' ? el.dataset[attr]! : el.dataset[keep]!);
    });
  }
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(STORE, next);
  } catch {
    // ignore
  }
  applyPage();
  listeners.forEach((listener) => listener());
}

if (typeof document !== 'undefined') applyPage();
