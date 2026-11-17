import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

// Source clips used inside the project videos (see ../[slug].astro). Like the video pages, they
// exist only in development and while `npm run videos` records; the published site has none.
const dir = path.resolve('src/assets/video');

export function getStaticPaths() {
  const enabled = import.meta.env.DEV || process.env.RENDER_VIDEOS === '1';
  if (!enabled || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.mp4'))
    .map((file) => ({ params: { name: file.replace(/\.mp4$/, '') } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(fs.readFileSync(path.join(dir, `${params.name}.mp4`)), {
    headers: { 'Content-Type': 'video/mp4' },
  });
