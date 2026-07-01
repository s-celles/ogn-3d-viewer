<p align="center"><img src="assets/banner.png" alt="OGN 3D Viewer" width="100%"></p>

# OGN 3D Viewer

*Read this in [French / Français](README.fr.md).*

**3D replay of glider flights from the [Open Glider Network](http://wiki.glidernet.org/) (OGN), in your browser.**

👉 **Live demo: https://s-celles.github.io/ogn-3d-viewer/**

Pick an airfield (ICAO code) and a date, and the viewer reconstructs the day's
glider tracks over 3D terrain — with playback, a cockpit (first-person) view,
and a head-up display showing heading, altitude and vario.

**Deep linking:** the airfield and date can be passed as URL parameters, e.g.
`…/ogn-3d-viewer/?icao=LFBI&date=2024-06-01`, so you can link straight to a day
(for instance from the [OGN FlightBook](https://flightbook.glidernet.org/)). The
URL stays in sync as you load airfields, and the info panel links back to the
matching FlightBook page.

![OGN 3D Viewer](https://img.shields.io/badge/status-live-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![Bun](https://img.shields.io/badge/bundler-Bun-f9f1e1)

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="assets/screencaptures/overview.png" alt="Overview"><br><sub><b>Overview</b> — a day's tracks over 3D terrain.</sub></td>
    <td width="50%"><img src="assets/screencaptures/cockpit.png" alt="Cockpit view"><br><sub><b>Cockpit</b> (first-person) view with the head-up display.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screencaptures/chase.png" alt="Chase camera"><br><sub><b>Chase camera</b> with the glider model and anti-collision indicator.</sub></td>
    <td width="50%"><img src="assets/screencaptures/graphs.png" alt="Graphs"><br><sub><b>Graphs</b> drawer — altitude, speed and heading.</sub></td>
  </tr>
</table>

## Features

**Loading data**

- **Airfield search** by ICAO code with autocomplete, for a given date.
- **Live mode** — a real-time view pinned to the current time that auto-refreshes active gliders every 20 s (online fixes full-colour, stale ones dimmed like the FlightBook live map).
- **Local file import** — drop (or pick) your own **IGC / GPX / KML** tracks to replay them the same way, no OGN round-trip.

**Scene**

- **3D terrain** with satellite imagery and adjustable vertical exaggeration.
- **Three views:** top-down overview, cockpit (first-person — the horizon banks in turns) and a chase cam following the glider.
- **Cockpit camera modes:** lock-to-heading or free look.
- **Head-up display (HUD):** heading, altitude and vario for the followed glider.
- **Final-glide cone:** an optional reachability cone around the airfield (adjustable glide ratio, arrival safety height and radius) — an aircraft above the surface can reach the field.
- **Ground shadows:** a blob/line under each glider, cast straight down (position indicator) or along the sun direction, to read height over the ground.
- **Altitude curtain:** a translucent drape from each track down to its ground projection for a strong sense of height.
- **Per-aircraft labels** with selectable fields (registration, altitude, speed, vario, heading).

**Playback**

- **Time playback** with a time-of-day scrubber and 1× / 8× / 30× / 120× speeds.
- **Track display modes:** history, history + future, or a rolling time window.
- **Trail effects:** basic, glow (neon), contrail or bloom.
- **Track smoothing:** Catmull-Rom spline interpolation between beacons for fluid trajectories (on by default, toggle in the panel).
- **Reception-loss gaps:** intervals with no OGN beacons are interpolated and drawn dashed.
- **Time-series graphs** drawer — altitude, speed and heading, following the same history / history + future / rolling modes.

**Flight instruments & traffic**

- **Estimated attitude:** each glider is drawn as a wing/fuselage marker that banks in turns (from turn rate × ground speed) and pitches with airspeed, capped at sane max angles.
- **Compensated vario:** the HUD shows a total-energy vario by default (toggle off for the raw climb rate). True airspeed isn't available from GPS, so ground speed is used as a proxy — exact only in still air.
- **Vario audio:** an optional climb/sink tone for the followed glider.
- **Traffic awareness** (focus views): a track-up **radar** of nearby airborne aircraft, or a **directional** anti-collision indicator with alert/warn threat levels by horizontal and vertical separation.

**UI & app**

- **Trilingual UI** (English / French / German), auto-detected from the browser.
- **Deep linking** via `?icao=…&date=…` URL parameters, kept in sync as you load.
- **Persisted settings:** your display/replay preferences are saved in `localStorage`, with one-click reset to defaults.
- **Installable PWA** — a web-app manifest plus a service worker that keeps the app shell available offline and caches map tiles persistently (sized to device RAM) so revisits are instant.
- **Map attribution** overlay (Esri imagery, AWS terrain), toggleable on the map.
- **Keyboard shortcuts:** `V` switch view, `1/2/3` pick a glider, `J/K` previous/next glider, `Space` play/pause, arrows to orbit/tilt/zoom.

## How it works

A **client-side single-page app** written in **TypeScript** and bundled with
**[Bun](https://bun.sh/)** — no backend. The source lives in [`src/`](src/) as
small ES modules ([`igc.ts`](src/igc.ts) parsing, [`flight-math.ts`](src/flight-math.ts)
geometry, [`terrain.ts`](src/terrain.ts), [`render.ts`](src/render.ts),
[`ui.ts`](src/ui.ts), a shared [`state.ts`](src/state.ts), etc.). It uses:

- [deck.gl](https://deck.gl/) (the scoped `@deck.gl/*` npm packages, tree-shaken)
  for the 3D terrain and track rendering;
- the public [OGN FlightBook API](https://flightbook.glidernet.org/) for the
  logbook and IGC tracks (called directly from the browser — the API exposes
  open CORS);
- AWS Terrarium elevation tiles and Esri World Imagery for the terrain.

The [build script](scripts/build.ts) also emits a web-app manifest, icons and a
service worker ([`sw.js`](scripts/build.ts)): the app shell is served
network-first (a new deploy updates as soon as you're online, and works offline
otherwise), while map tiles are cached persistently (cache-first) so revisits
don't re-download them. Preferences live in `localStorage` (see
[`settings.ts`](src/settings.ts)).

## Tech stack

- **TypeScript** (strict) — domain types for tracks, the FlightBook API and the
  shared app state.
- **Bun** — bundler, dev server and test runner, no separate toolchain.
- **deck.gl 9** via tree-shaken scoped packages, plus `upng-js` for pure-JS
  terrain-tile decoding.

## Development

Requires [Bun](https://bun.sh/). Install dependencies once, then:

```bash
git clone https://github.com/s-celles/ogn-3d-viewer.git
cd ogn-3d-viewer
bun install

bun run serve      # build once + serve dist/ on http://localhost:3000
bun run dev        # rebuild dist/ on every change (watch; pair with a static server)
bun run build      # production build (minified) → dist/
bun test           # unit tests for the pure modules (igc, flight-math)
bun run typecheck  # tsc --noEmit
```

`bun run serve` is the quick way to look at the app. For a live edit loop, run
`bun run dev` (rebuilds `dist/` on save) in one terminal and serve `dist/` in
another (e.g. `python3 -m http.server -d dist 3000`).

> Note: we bundle with [`bun build`](https://bun.sh/docs/bundler) rather than
> Bun's built-in HTML dev server (`bun ./index.html`) — the latter's on-the-fly
> module splitting mis-resolves the deck.gl/luma graph and breaks the terrain
> mesh. deck.gl and luma.gl are pinned to 9.1.0 (see the `overrides` in
> [`package.json`](package.json)) because luma 9.3 changed the mesh API our
> hand-built terrain relies on.

## Data limitations

OGN data is community-sourced and comes with caveats — these are also shown in
the app via the ⓘ button:

- Tracks depend on ground-station reception: gaps, dropouts or truncated climbs are possible.
- Only aircraft **registered and "tracked"** in the OGN database appear; anonymous or non-equipped aircraft are missing.
- Positions are interpolated between received beacons — not exactly the path actually flown.
- GNSS altitude is shown over MSL terrain: slight floating near the ground is possible (geoid offset of tens of metres).
- No attitude data is transmitted: the displayed bank/pitch (and the banking horizon) are **estimated** from ground track and speed, not measured.
- **OGN keeps IGC tracks for only ~24 hours**, so older dates often have no replayable data.

Please review and respect the official
[OGN data usage policy](https://www.glidernet.org/ogn-data-usage/).

## Deployment

The site is published to **GitHub Pages** automatically by the
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) GitHub Actions
workflow on every push to `main`: it sets up Bun, type-checks, runs the tests,
builds to `dist/`, and publishes that folder. Asset URLs are emitted relative
(`--public-path=./`) so the build works under the project's `/ogn-3d-viewer/`
sub-path.

To enable it on a fork: go to **Settings → Pages → Build and deployment → Source**
and select **GitHub Actions**.

## AI assistance disclosure

This project was developed with the assistance of AI tools. AI was used to help
write and refine the application code, the deployment workflow and this
documentation. All output was reviewed by a human maintainer before publication.

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see
[`LICENSE`](LICENSE). In short: you may use, modify and redistribute this code,
but if you run a modified version as a network service you must make your
modified source available to its users.

OGN data belongs to the [Open Glider Network](http://wiki.glidernet.org/) and
its contributors.
