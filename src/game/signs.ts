// Textures drawn on a canvas: the boards in front of the places (logo, name, tools) and the tool
// tiles of the Skills masts. Logos are loaded from the built site; icons come as SVG paths.
import * as THREE from 'three';
import type { ToolIcon } from './icons';
import type { Sign } from './stations';

const FONT_DISPLAY = '"Space Grotesk Variable", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
const INK = '#111713';
const MUTED = '#4f5b54';
const ACCENT = '#c3f25e';

/** Textures to redraw once the web fonts have loaded. */
const redraws: (() => void)[] = [];
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.ready.then(() => redraws.forEach((draw) => draw()));
}

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** An icon in its brand color, or the tool's name in a pill when it has no icon. Returns the width used. */
function drawIcon(ctx: CanvasRenderingContext2D, icon: ToolIcon, x: number, y: number, size: number, measureOnly = false): number {
  if (icon.path) {
    if (!measureOnly) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size / 24, size / 24);
      ctx.fillStyle = icon.hex;
      ctx.fill(new Path2D(icon.path));
      ctx.restore();
    }
    return size;
  }
  ctx.font = `500 ${Math.round(size * 0.36)}px ${FONT_MONO}`;
  const w = ctx.measureText(icon.title).width + size * 0.5;
  if (!measureOnly) {
    roundRect(ctx, x, y + size * 0.18, w, size * 0.64, size * 0.12);
    ctx.strokeStyle = '#c3cdbe';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(icon.title, x + size * 0.25, y + size * 0.5);
  }
  return w;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The board in front of a place, 2:1. */
export function signTexture(sign: Sign): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const map = texture(canvas);
  let logo: HTMLImageElement | null = null;

  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, 18, H);

    const pad = 64;
    const hasIcons = sign.icons.length > 0;
    const top = hasIcons ? 300 : 380;

    if (logo && logo.naturalWidth) {
      const box = { w: W - pad * 2, h: top - 40 - pad };
      const k = Math.min(box.w / logo.naturalWidth, box.h / logo.naturalHeight);
      const w = logo.naturalWidth * k;
      const h = logo.naturalHeight * k;
      ctx.drawImage(logo, pad, pad + (box.h - h) / 2, w, h);
    } else {
      ctx.fillStyle = INK;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      let size = 76;
      let lines: string[];
      do {
        ctx.font = `600 ${size}px ${FONT_DISPLAY}`;
        lines = wrap(ctx, sign.title, W - pad * 2);
        size -= 4;
      } while ((lines.length > 2 || lines.length * size * 1.1 > top - 60 - pad) && size > 30);
      const lineH = (size + 4) * 1.08;
      lines.slice(0, 2).forEach((line, i) => ctx.fillText(line, pad, pad + lineH * (i + 0.85)));
    }

    ctx.font = `500 34px ${FONT_MONO}`;
    ctx.fillStyle = MUTED;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let sub = sign.sub;
    while (ctx.measureText(sub).width > W - pad * 2 && sub.length > 4) sub = `${sub.slice(0, -2)}…`;
    ctx.fillText(sub, pad, top);

    if (hasIcons) {
      const size = 84;
      let x = pad;
      for (const icon of sign.icons) {
        const w = drawIcon(ctx, icon, 0, 0, size, true);
        if (x + w > W - pad) break;
        drawIcon(ctx, icon, x, top + 40, size);
        x += w + 30;
      }
    }
    map.needsUpdate = true;
  };

  if (sign.logo) {
    logo = new Image();
    logo.onload = draw;
    logo.src = sign.logo;
  }
  draw();
  redraws.push(draw);
  return map;
}

/** A square tile with one tool, for the Skills masts. */
export function toolTexture(icon: ToolIcon): THREE.CanvasTexture {
  const S = 160;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const map = texture(canvas);
  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, S, S);
    roundRect(ctx, 4, 4, S - 8, S - 8, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (icon.path) {
      drawIcon(ctx, icon, 30, 30, S - 60);
    } else {
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 34;
      let lines: string[];
      do {
        ctx.font = `600 ${size}px ${FONT_DISPLAY}`;
        lines = wrap(ctx, icon.title.replace(' / ', '/'), S - 24);
        size -= 2;
      } while ((lines.length > 3 || lines.some((l) => ctx.measureText(l).width > S - 20)) && size > 14);
      const lineH = size * 1.15;
      lines.forEach((line, i) => ctx.fillText(line, S / 2, S / 2 + (i - (lines.length - 1) / 2) * lineH));
    }
    map.needsUpdate = true;
  };
  draw();
  redraws.push(draw);
  return map;
}

/** Text drawn on a transparent canvas in the palette accent, for the hall's pediment. */
export function lettering(text: string, color: () => string): { map: THREE.CanvasTexture; redraw: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const map = texture(canvas);
  const redraw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color();
    ctx.font = `600 104px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 6);
    map.needsUpdate = true;
  };
  redraw();
  redraws.push(redraw);
  return { map, redraw };
}
