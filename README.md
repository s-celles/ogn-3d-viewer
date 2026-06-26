# OGN 3D Viewer

*Read this in [French / Français](README.fr.md).*

**3D replay of glider flights from the [Open Glider Network](http://wiki.glidernet.org/) (OGN), in your browser.**

👉 **Live demo: https://s-celles.github.io/ogn-3d-viewer/**

Pick an airfield (ICAO code) and a date, and the viewer reconstructs the day's
glider tracks over 3D terrain — with playback, a cockpit (first-person) view,
and a head-up display showing heading, altitude and vario.

![OGN 3D Viewer](https://img.shields.io/badge/status-live-brightgreen) ![No build step](https://img.shields.io/badge/build-none-blue)

## Features

- **Airfield search** by ICAO code with autocomplete.
- **3D terrain** with satellite imagery and adjustable vertical exaggeration.
- **Time playback** with a time-of-day scrubber and 1× / 8× / 30× / 120× speeds.
- **Live mode** — a real-time view pinned to the current time that auto-refreshes active gliders every 20 s.
- **Two views:** top-down overview and cockpit (first-person) view.
- **Cockpit camera modes:** lock-to-heading or free look.
- **Track display modes:** history, history + future, or a rolling time window.
- **Head-up display (HUD):** heading, altitude and vario for the followed glider.
- **Bilingual UI** (English / French), auto-detected from the browser.
- **Keyboard shortcuts:** `V` switch view, `1/2/3` pick a glider, `Space` play/pause, arrows to orbit/tilt/zoom.

## How it works

This is a **single static HTML file** ([`index.html`](index.html)) — no backend,
no build step. It uses:

- [deck.gl](https://deck.gl/) for the 3D terrain and track rendering;
- the public [OGN FlightBook API](https://flightbook.glidernet.org/) for the
  logbook and IGC tracks (called directly from the browser — the API exposes
  open CORS);
- AWS Terrarium elevation tiles and Esri World Imagery for the terrain.

## Data limitations

OGN data is community-sourced and comes with caveats — these are also shown in
the app via the ⓘ button:

- Tracks depend on ground-station reception: gaps, dropouts or truncated climbs are possible.
- Only aircraft **registered and "tracked"** in the OGN database appear; anonymous or non-equipped aircraft are missing.
- Positions are interpolated between received beacons — not exactly the path actually flown.
- GNSS altitude is shown over MSL terrain: slight floating near the ground is possible (geoid offset of tens of metres).
- No attitude data: the camera does not bank in turns.
- **OGN keeps IGC tracks for only ~24 hours**, so older dates often have no replayable data.

Please review and respect the official
[OGN data usage policy](https://www.glidernet.org/ogn-data-usage/).

## Running locally

Because everything runs client-side, you can just open the file — but a tiny
local web server avoids any browser file:// restrictions:

```bash
git clone https://github.com/s-celles/ogn-3d-viewer.git
cd ogn-3d-viewer
python -m http.server 8000
# then open http://localhost:8000/
```

## Deployment

The site is published to **GitHub Pages** automatically by the
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) GitHub Actions
workflow on every push to `main`.

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
