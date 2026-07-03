# OGN 3D Viewer — Guide

3D replay of glider flights from the [Open Glider Network](http://wiki.glidernet.org/) (OGN), in your browser. Pick an airfield and a date — or load your own tracks — and replay the day over 3D terrain, with playback, a cockpit view and a head-up display.

## Loading data

- **Discover spots** — the "🌍 Discover spots" button opens an explorer of famous gliding sites worldwide (records, championships), grouped by **continent tabs**; a click loads the site. Sites not covered by the FlightBook are dimmed but still explorable as **terrain only** (via their coordinates).
- **Airfield search** — by code (ICAO, or a national/FAA identifier) with autocomplete, for a given date.
- **Live mode** — a real-time view pinned to the current time, refreshing active gliders every 20 s (recent fixes in full colour, older ones dimmed).
- **Local file import** — drop or pick your own **IGC / GPX / KML** tracks to replay them the same way, without going through OGN.

## The scene

- **3D terrain** with satellite imagery and adjustable vertical exaggeration.
- **Ground resolution** — adjustable satellite-imagery detail level (z13 to z18).
- **Three views** — top-down overview, cockpit (first-person, the horizon banks in turns) and a chase camera following the glider.
- **Cockpit camera** — lock-to-heading or free look.
- **Head-up display (HUD)** — heading, altitude and vario for the followed glider.
- **Final-glide cone** — an optional reachability cone around the airfield (adjustable glide ratio, safety height and radius).
- **Ground shadows** — cast straight down (position indicator) or along the sun direction.
- **Altitude curtain** — a translucent drape from each track down to the ground.
- **Per-aircraft labels** — registration, altitude, speed, vario, heading.

## Playback

- **Time playback** — a time-of-day scrubber and 1× / 4× / 8× / 30× / 120× speeds.
- **Track modes** — history, history + future, or a rolling window.
- **Trail effects** — basic, neon glow, contrail or bloom.
- **Track smoothing** — Catmull-Rom spline interpolation for fluid trajectories.
- **Reception gaps** — intervals with no OGN beacon are interpolated and drawn dashed.
- **Graphs** — altitude, speed and heading over time.

## Instruments & traffic

- **Estimated attitude** — each glider banks in turns and pitches with airspeed.
- **Compensated vario** — total-energy vario by default (toggle off for the raw climb rate).
- **Vario audio** — an optional climb/sink tone for the followed glider.
- **Traffic awareness** — a track-up radar of nearby aircraft, or a directional anti-collision indicator.

## Settings & performance

- **Saved settings** — your preferences (views, effects, exaggeration, language, etc.) are stored locally and restored on your next visit; the **↺** button resets them to defaults.
- **Cache size** — a multiplier (×0.5 to ×4) on the in-memory **and** on-disk caches; the estimated usage is shown in the **ⓘ** panel. Defaults already scale with the device's memory (more generous on desktop).
- **Installable app (PWA)** — installable and usable **offline**; already-visited tiles persist across sessions.
- **Languages** — French, English, German, Spanish, Italian (auto-detected).

- **Shareable links** — the **🔗** button copies a link that reopens the exact state: airfield, date, live/replay, **view** (overview/cockpit/chase), followed aircraft, speed and the playback **moment**.

## Developer mode

Add `?dev=1` to the URL for a technical panel: terrain **wireframe**, **bare relief** (no imagery), an **FPS** overlay, **cache counters**, and streaming tuners (request count, mesh density, cache sizes, view distance). `?dev=0` turns it off.

## Keyboard shortcuts

- **V** — switch view
- **1 / 2 / 3** — pick a glider
- **J / K** — previous / next glider
- **Space** — play / pause
- **Arrows** — orbit / tilt / zoom

## Notes & limitations

- OGN tracks depend on ground-station reception — gaps and dropouts are possible.
- Attitude (bank/pitch) is **estimated** from ground track and speed, not measured.
- OGN keeps IGC tracks for only **~24 hours**, so older dates are often empty.
- Please respect the [OGN data usage policy](https://www.glidernet.org/ogn-data-usage/).

The app is a client-side single-page app; source and issues on [GitHub](https://github.com/s-celles/ogn-3d-viewer).
