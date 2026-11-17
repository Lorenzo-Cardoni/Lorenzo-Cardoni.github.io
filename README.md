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
| `videos.json` | Content of the project videos, one entry per video |
| `background.json` | Publications, education, competitions, spoken languages |
| `skills.json` | Skill groups |

Notes:

- Project and profile images go in `src/assets/` and are referenced by file name. Astro resizes and converts them at build time.
- A featured project uses `"fit": "cover"` to fill its frame, `"fit": "contain"` to show the whole image on a white background, or `"fit": "natural"` to give the frame the image's own proportions (for a small image that would blur if enlarged).
- The timeline is built from the `period` fields of `experience.json` and `background.json` (and the `date` of each publication). Write them as `Apr 2025 – Oct 2025`, `Apr 2026 – Present`, `Mar 2024` or `2024`. A publication can set `shortTitle` and `venueShort` for its timeline row.
- Leave a project's `link` empty to hide its repository link.
- The CV is `public/Cardoni_Lorenzo_Resume.pdf`. Replace the file, keeping the name, to update it.
- `public/og.png` (1200×630) is the preview image shown when the site is shared.
- `src/assets/unused/` holds images that are not shown on the site and are not shipped.

## Project videos

A featured project with a `video` field in `projects.json` opens a short video in a dialog. All videos share one template, `src/pages/video/[slug].astro`, which uses the site's own colors and fonts and plays six scenes: title, problem, approach, proof of concept, results, next steps. The text and numbers of each video live in `src/data/videos.json`, under the same name as the project's `video` field.

```bash
npm run dev                      # preview a video at http://localhost:4321/video/<name>
npm run videos                   # record every video into public/videos/
npm run videos -- geoposball     # record only the named ones
```

Recording needs `ffmpeg` and a Chromium-based browser (Chrome, Chromium, Edge or Brave). Set `CHROME_PATH` if the browser is not found, and `CHROME_ARGS="--no-sandbox"` inside a container. The recorded `.mp4` and `.jpg` files in `public/videos/` are committed: the deploy workflow does not record them.

The proof-of-concept scene shows one of four things, set by `media.type`: an `image` from `src/assets/`, a `clip` from `src/assets/video/`, the fault `signals` chart or the feature-map `scales` diagram. The video pages and source clips exist only in development and while recording; they are not part of the published site.

To add a video: write its entry in `videos.json`, set `"video": "<name>"` on the project, run `npm run videos -- <name>` and commit the two new files.

## The island (`/play/`)

`/play/` shows the same portfolio as a 3D island to fly over with a drone, built with [three.js](https://threejs.org/). It reads the same data files, so it needs no separate editing:

- Every job, degree, publication, competition and featured project with a date stands along the road around the island, in chronological order, with a gate for each new year. Featured projects without a year stand inside the ring; the `more` projects stand on plinths along the avenue to the lighthouse (Contact). Profile is the landing pad in the centre and Skills has one mast per group.
- Flying close to a place logs it (the visitor's progress is kept in the browser). Its full text is printed in the page's HTML, so it stays readable for search engines and screen readers, and the "Places" list doubles as an autopilot.
- Known entries get their own model, matched by name in `KNOWN` in `src/game/stations.ts`; a new entry the table does not know gets a generic building and still finds its place on the timeline. A `near` pattern in the same table puts an entry next to another one instead of in its own spot (the lab job beside GeoPosBall, the paper beside the super-resolution project).
- Besides the drone, the visitor can take the Bosch car, the e-bike and the GeoPosBall boat (key E, or the button that appears next to them). Car and bike stay on land, the boat at sea.
- A lit path with moving chevrons leads from the landing pad to the first year gate.
- The `more` projects marked `museum: true` in `KNOWN` stand inside the "Data science hall", a temple on the avenue that the drone and the vehicles can enter; the hall is a place of its own that lists them.
- Each place has a board with its logo and the tools used there. Logos are files in `src/assets/logos/`, named in `KNOWN` (`inim.png`, `lega-del-filo-doro.jpg`, `pieralisi.jpg`); when a file is missing the board shows the name instead, so adding `src/assets/logos/univpm.png` is enough to show the university logo. Tool icons come from [simple-icons](https://simpleicons.org/) (CC0), matched on the names in the data files; tools without an icon get a text tile.
- Without WebGL the page falls back to the list of places, each opening its entry.

Code: `src/game/layout.ts` (island shape and roads), `stations.ts` (data to places, runs at build time), `models.ts` (low-poly models), `world.ts` (scene), `game.ts` (flight, detection, interface), `palette.ts` (colors for both themes).

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
  pages/        index, play (the 3D island), robots.txt, llms.txt, and the video template
  game/         The 3D island: layout, models, scene and game loop
scripts/        render-videos.mjs, which records the project videos
  styles/       Design tokens and shared styles
```

Colors, fonts and spacing are defined as CSS variables at the top of `src/styles/global.css`, once for the dark theme and once for the light theme.

## Credits

The project started from the MIT-licensed [career-portfolio-template](https://github.com/nbakh16/career-portfolio-template) by Nabil Akhunjee; see `LICENSE`.
