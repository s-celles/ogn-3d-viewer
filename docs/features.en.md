# OGN 3D Viewer — Guide

3D replay of glider flights from the [Open Glider Network](http://wiki.glidernet.org/) (OGN), in your browser. Pick an airfield and a date — or load your own tracks — and replay the day over 3D terrain, with playback, a cockpit view and a head-up display.

## Loading data

- **Airfield search** — by ICAO code with autocomplete, for a given date.
- **Live mode** — a real-time view pinned to the current time, refreshing active gliders every 20 s (recent fixes in full colour, older ones dimmed).
- **Local file import** — drop or pick your own **IGC / GPX / KML** tracks to replay them the same way, without going through OGN.

## The scene

- **3D terrain** with satellite imagery and adjustable vertical exaggeration.
- **Three views** — top-down overview, cockpit (first-person, the horizon banks in turns) and a chase camera following the glider.
- **Cockpit camera** — lock-to-heading or free look.
- **Head-up display (HUD)** — heading, altitude and vario for the followed glider.
- **Final-glide cone** — an optional reachability cone around the airfield (adjustable glide ratio, safety height and radius).
- **Ground shadows** — cast straight down (position indicator) or along the sun direction.
- **Altitude curtain** — a translucent drape from each track down to the ground.
- **Per-aircraft labels** — registration, altitude, speed, vario, heading.

## Playback

- **Time playback** — a time-of-day scrubber and 1× / 8× / 30× / 120× speeds.
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
