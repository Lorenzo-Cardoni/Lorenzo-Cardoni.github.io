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

## Isola Vitae (`/play/`)

`/play/` shows the same portfolio as a 3D island, Isola Vitae, to explore as a small ghost, built with [three.js](https://threejs.org/). It reads the same data files, so it needs no separate editing:

- The island is a ring of lowland around a mountain, plus an islet to the east (`src/game/layout.ts`). The timeline road runs around the mountain through five zones, each closed off by an obstacle: a steep ramp (the e-bike climbs it), a river (the Bosch car jumps it at full speed, once the tourists of the 2023 hackathon make way), a checkpoint where an armed man among passers-by shoots at anyone coming close (possess the security camera, once the super-resolution project is known: his weapon glows in the picture, and holding him in view identifies it; the police then come and send him flying out over the ocean), a gorge blocked by litter (the litter robot clears it) and the sea (the GeoPosBall boat). On the islet a broken drone waits in its vault; it flies once the visitor has learned from the CNN and the data science projects, standing in the open on a plaza, and the Pieralisi motor has charged it, and it reaches the mountain: Lega del Filo d'Oro, the volleyball court (where a player hits anyone who comes close, until the camera beside the court identifies him), Inim, then the profile, a statue of the AI engineer among the skill masts, on the way out to the cape, and the Contact lighthouse last.
- The goal is to get to know every place, in any order: walking up to a place shows a small card (Enter, or "More", opens its full page). A line at the top of the screen, an orange arrow over the spot and a ring on the minimap always show what to do next, worked out from the progress; an obstacle is named only once the visitor has met it. The answer to an obstacle stands at the end of a side path that leaves the road just before it (`SIDE` in `src/game/layout.ts`): the 2023 hackathon beside the tourists, super-resolution before the checkpoint. The publications stay on the portfolio page and have no place on the island. `StationDef.order` is the suggested route the places list follows: zone by zone, then along the road.
- The visitor is a small ghost that walks and cannot fly or swim. It possesses machines with E, or the button that appears next to them, and once it has possessed one it can turn into it again at any time from the shapes menu (Q, then the arrows and Enter). On foot a place is seen only from its own zone. Visiting GeoPosBall switches the GPS on, which draws the minimap.
- The counter shows how many places are known, and the last one opens an end screen with contact links, "Keep exploring" and "Start over". The "Places" list follows the order of the way and travels to places in zones already reached (the ghost reappears there) or, once the drone flies, anywhere by autopilot. Every entry's full text is printed in the page's HTML, so it stays readable for search engines and screen readers. Progress is kept in the browser.
- The `more` projects marked `museum: true` in `KNOWN` (the MSc data science courses) stand in the open on the islet's plaza, in a ring with the CNN.
- Workplaces and schools (Inim, Pieralisi, Lega del Filo d'Oro, the UNIVPM campus) have a board with their logo and the tools used there. Logos are files in `src/assets/logos/`, named in `KNOWN` (`inim.png`, `lega-del-filo-doro.jpg`, `pieralisi.jpg`, `logo-univpm.webp`); when a file is missing the board shows the name instead. Tool icons come from [simple-icons](https://simpleicons.org/) (CC0), matched on the names in the data files; tools without an icon get a text tile.
- The island is always seen by day, in a warm, stylized look: soft, rounded shapes, a single earthy palette (`src/game/palette.ts`), a warm low sun with soft shadows, haze and a glow in the sky, and film-like tone mapping. Boxes of some size have softly rounded edges; the ground, the roads and the walls carry a light grain, tall grass sways in the wind, the sea ripples and glints, and dust rises behind the wheels and spray behind the boat (`src/game/look.ts`: the grain and the water read a small tiling noise texture with world coordinates, so the merged models need no UVs). On a computer the picture also gets ambient occlusion and a light bloom; they go if frames drop below about 50 a second, then the resolution and the shadows below about 28. The scenery is cut into blocks so what is out of view is skipped, and the sun's shadows are redrawn every other frame. The site's light and dark themes change only the interface around the game.
- Every person on the island has the same chubby, toy-like shape (`person` in `models.ts`), from the crowds to the statue. The land is filled with pines, round trees, bushes, grass and patches of flowers, and clouds drift overhead, each kind drawn as one set of instances.
- English or Italian: the language button switches the game's own texts (`src/game/i18n.ts`; texts in the code come as `t(english, italian)`, the page's as `data-it`, `data-it-html`, `data-it-aria`). The game starts in Italian until the visitor picks English. The entries of the places come from the data files, in English.
- The view starts far behind the ghost or the machine, near the farthest the zoom allows; the security cameras see wide. The ghost is soft and almost see-through, with small electric sparks around it. The tourists make way one after another, slowly.
- A secret: a crate of explosives hidden among boulders on the top of the mountain (`CAVE` in `layout.ts`). Once found, X (or the bomb button) drops a charge: it falls from where it is dropped (with the drone's speed), bounces, rolls down slopes, sinks in the sea, and goes off two seconds later. The blast digs a crater into the ground (never below the sea), clears trees and bushes, slumps buildings into ruins (not the ones with machines), blows away litter and shakes the view. Finding the explosives is saved; the damage is not.
- Activities on the mountain, once each place is known: at Lega del Filo d'Oro, gather five data packets into a pipeline and the access dashboard lights up; at Inim Electronics, switch on four alarm sensors around the office, then arm the system at the control panel. The objective line leads through them.
- A force field covers the AI engineer platform (the profile among the skills) until Inim Electronics is secure: its alarm system armed. Until then it cannot be reached or known.
- Details: a wall of boulders across the plateau leaves the road as the only way past the tourists; the Pieralisi motor has a charge bar over its bench; the volleyball player, once identified, is swallowed by a carnivorous plant; on a computer the text and the minimap are larger.
- Without WebGL the page falls back to the list of places, each opening its entry.

Code: `src/game/layout.ts` (island shape, zones and roads), `stations.ts` (data to places, runs at build time), `models.ts` (models), `world.ts` (scene), `game.ts` (the ghost, the machines, detection, interface), `palette.ts` (the day palette and its materials), `look.ts` (grain, wind, water, dust).

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
