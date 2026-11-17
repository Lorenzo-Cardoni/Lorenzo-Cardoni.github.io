// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import profile from './src/data/profile.json';

// SITE_URL can override the URL from profile.json at build time (e.g. for a custom domain).
const siteUrl = process.env.SITE_URL || profile.seo.siteUrl;

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  integrations: [sitemap()],
  // Hide the Astro toolbar that `npm run dev` shows at the bottom of the page.
  devToolbar: { enabled: false },
  // three.js, loaded only by /play, is a single ~600 kB chunk (about 150 kB gzipped).
  vite: { build: { chunkSizeWarningLimit: 800 } },
});
