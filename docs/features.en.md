# OGN 3D Viewer — Guide

3D replay of glider flights from the [Open Glider Network](http://wiki.glidernet.org/) (OGN), in your browser. Pick an airfield and a date — or load your own tracks — and replay the day over 3D terrain, with playback, a cockpit view and a head-up display.

## Loading data

- **Discover spots** — the "🌍 Discover spots" button opens an explorer of famous gliding sites worldwide (records, championships), grouped by **continent tabs**; a click loads the site. The list is **filterable** by country and free-text search (persisted, with a **↺** reset), which also filters the map markers. Sites not covered by the FlightBook are dimmed but still explorable as **terrain only** (via their coordinates). It's also the app's **landing page**, shown on startup (unless a `?icao=` deep link is used) and giving access to the language, the 📖 guide and the ⓘ info.
- **Hot spots (live)** — the **🔥** tab scans the OGN live network worldwide and ranks the areas where the most gliders are airborne *right now*, shown both as a list and as sized dots on the world map; click one to **load the airfield and its day's flights** — even areas named after an **OGN receiver** (no airfield code) are resolved to the nearest FlightBook airfield (distance-checked). The list is **filterable and sortable** — by country, a free-text search, and by activity / name / country — and these preferences are **saved** (localStorage) with a **↺** reset. The scan itself is throttled (a shared network): the header shows how long ago it ran and the **↻** button only re-scans after 15 minutes. Only aggregate counts per area are used, never individual aircraft.
- **Airfield search** — by code (ICAO, or a national/FAA identifier) with autocomplete, for a given date.
- **Live mode** — a real-time view pinned to the current time, refreshing active gliders every 20 s (recent fixes in full colour, older ones dimmed).
- **Local file import** — drop or pick your own **IGC / GPX / KML** tracks (or a SeeYou **`.cup`** waypoint file — see *Points of interest*) to replay them the same way, without going through OGN.

## The scene

- **3D terrain** with satellite imagery and adjustable vertical exaggeration.
- **Base map** — choose the layer draped over the terrain: **Esri** satellite, **OpenTopoMap** or **OpenStreetMap** (the choice is saved).
- **France detail (IGN)** — *experimental, off by default*: over France it swaps in a much finer terrain (IGN **RGE ALTI / LIDAR HD**) and **20 cm BD ORTHO** aerial imagery (keyless Géoplateforme), falling back to the global sources everywhere else. Toggle it on to try it.
- **Ground resolution** — adjustable satellite-imagery detail level (z13 to z18).
- **Three views** — top-down overview, cockpit (first-person, the horizon banks in turns) and a chase camera following the glider.
- **Cockpit camera** — lock-to-heading or free look.
- **Head-up display (HUD)** — heading, altitude and vario for the followed glider.
- **Final-glide cone** — an optional reachability cone around the airfield (adjustable glide ratio, safety height and radius).
- **Ground shadows** — cast straight down (position indicator) or along the sun direction.
- **Altitude curtain** — a translucent drape from each track down to the ground.
- **Per-aircraft labels** — registration, altitude, speed, vario, heading.
- **Points of interest** — show named **OpenStreetMap summits** around the view (a pole + elevation, adjustable density, label size scaling with the summit's importance), and/or import your **SeeYou `.cup`** waypoints (airfields, turnpoints, obstacles…). Each point gets an **icon for its type**: ✈ airfield, ▽ outlanding field, ▲ summit/pass, ✕ obstacle (mast, tower), ◆ landmark.
- **2D minimap** — a flat inset map (top-right) with the chosen base map plus the followed aircraft's track and position (or the focused one in the overview), to keep your bearings; other airborne aircraft show as dots. Toggleable.
- **HUD in the overview** *(opt-in, off by default)* — show the telemetry card (registration, heading, speed, altitude, vario) of the **focused** aircraft in the overview too. **J / K**, the **◀ / ▶** and **1 / 2 / 3** change the focused aircraft (panning hands focus back to the one nearest the centre).
- **Active aircraft only** *(opt-in, off by default)* — only show and cycle aircraft **airborne at the current time**; hides the others' traces and legend rows (never the one you follow).

## Playback

- **Time playback** — a time-of-day scrubber, **forward and reverse** play, 0.25× / 1× / 4× / 8× / 30× presets, and a custom-speed field for any other value (e.g. 0.5×, 120×).
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

- **Shareable links** — the **🔗** button copies a link that reopens the exact state: airfield, date, live/replay, **view** (overview/cockpit/chase), followed aircraft, speed and the playback **moment**. The **ⓘ** panel also shows a **QR code** of the current link — scan it to open the same view on a phone.

## Developer mode

Add `?dev=1` to the URL for a technical panel: terrain **wireframe**, **bare relief** (no imagery), an **FPS** overlay, **cache counters**, and streaming tuners (request count, mesh density, cache sizes, view distance). `?dev=0` turns it off.

## Keyboard shortcuts

- **V** — switch view
- **1 / 2 / 3** — pick a glider
- **J / K** — previous / next glider
- **Space** — play / pause (forward)
- **B** — play / pause backward
- **Arrows** — orbit / tilt / zoom

## Notes & limitations

- OGN tracks depend on ground-station reception — gaps and dropouts are possible.
- Attitude (bank/pitch) is **estimated** from ground track and speed, not measured.
- OGN keeps IGC tracks for only **~24 hours**, so older dates are often empty.
- Please respect the [OGN data usage policy](https://www.glidernet.org/ogn-data-usage/).

The app is a client-side single-page app; source and issues on [GitHub](https://github.com/s-celles/ogn-3d-viewer).
