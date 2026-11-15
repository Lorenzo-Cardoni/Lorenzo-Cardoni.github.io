# lorenzo-cardoni.github.io

Personal portfolio of Lorenzo Cardoni, AI Engineer. Live at <https://lorenzo-cardoni.github.io/>.

Static site built with [Astro](https://astro.build/). No UI framework and no CSS framework: plain Astro components with scoped CSS.

## Editing content

All text lives in `src/data/`. Changing these files is enough for most updates.

| File | Content |
| --- | --- |
| `profile.json` | Name, title, hero text, about, focus areas, social links, SEO fields |
| `experience.json` | Work experience, most recent first |
| `projects.json` | `featured` projects (with image) and `more` projects (compact cards) |
| `background.json` | Publications, education, competitions, spoken languages |
| `skills.json` | Skill groups |

Notes:

- Project and profile images go in `src/assets/` and are referenced by file name. Astro resizes and converts them at build time.
- A featured project uses `"fit": "cover"` to fill its frame, or `"fit": "contain"` to show the whole image on a white background.
- Leave a project's `link` empty to hide its repository link.
- The CV is `public/Cardoni_Lorenzo_Resume.pdf`. Replace the file, keeping the name, to update it.
- `public/og.png` (1200×630) is the preview image shown when the site is shared.
- `src/assets/unused/` holds images that are not shown on the site and are not shipped.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev      # local server with hot reload
npm run check    # type-check
npm run build    # production build in dist/
npm run preview  # serve the production build
```

## Deployment

Every push to `main` builds and publishes the site to GitHub Pages through `.github/workflows/deploy.yml`.

## Structure

```
src/
  components/   One component per page section, plus Icon and SectionHeading
  data/         Site content (JSON)
  layouts/      HTML shell, SEO tags, theme bootstrap
  pages/        index, robots.txt, llms.txt
  styles/       Design tokens and shared styles
```

Colors, fonts and spacing are defined as CSS variables at the top of `src/styles/global.css`, once for the dark theme and once for the light theme.

## Credits

The project started from the MIT-licensed [career-portfolio-template](https://github.com/nbakh16/career-portfolio-template) by Nabil Akhunjee; see `LICENSE`.
