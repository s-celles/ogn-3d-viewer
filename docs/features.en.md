# OGN 3D Viewer — Guide

3D replay of glider flights from the [Open Glider Network](http://wiki.glidernet.org/) (OGN), in your browser. Pick an airfield and a date — or load your own tracks — and replay the day over 3D terrain, with playback, a cockpit view and a head-up display.

## Loading data

- **Discover spots** — the "🌍 Discover spots" button opens an explorer of famous gliding sites worldwide (records, championships), grouped by **continent tabs**; a click loads the site. The list is **filterable** by country and free-text search (persisted, with a **↺** reset), which also filters the map markers. Sites not covered by the FlightBook are dimmed but still explorable as **terrain only** (via their coordinates). It's also the app's **landing page**, shown on startup (unless a `?icao=` deep link is used) and giving access to the language, the 📖 guide and the ⓘ info.
- **Hot spots (live)** — the **🔥** tab scans the OGN live network worldwide and ranks the areas where the most gliders are airborne *right now*, shown both as a list and as sized dots on the world map; click one to **load the airfield and its day's flights** — even areas named after an **OGN receiver** (no airfield code) are resolved to the nearest FlightBook airfield (distance-checked). The list is **filterable and sortable** — by country, a free-text search, and by activity / name / country — and these preferences are **saved** (localStorage) with a **↺** reset. The scan itself is throttled (a shared network): the header shows how long ago it ran and the **↻** button only re-scans after 15 minutes. Only aggregate counts per area are used, never individual aircraft.
- **Wave scan** — the **🌊** tab ranks the known spots by **mountain-wave potential** for the chosen date: it batch-fetches the upper wind and stability (Open-Meteo) and scores each site (cross-ridge wind × stability × a plausible wavelength × the site's **relief** and whether the **wind crosses a ridge** — so flat plains are dropped, and a site with several ridges is handled). It lists the wave terrains and tags each with the **day's chance** (workable / possible / low), so it is never empty. Every spot in the lists also carries a **terrain tag** — plain 🌾 / hills 🏞 / mountain ⛰ / high mountain 🏔 — classified à la **Kapos/Meybeck** from the local elevation range (≤12 km) and the region's peak altitude (high mountain ≥ 2500 m). The wave *chance* is separate and dynamic. *Weather first, then pick the field* — click a site to load it on a promising wave day.
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
- **Air mass** *(opt-in, off by default, experimental)* — reconstructs the **day's thermals** from the tracks (circling + climb) and shows them as **plumes** capped by **cumulus** at a common base, leaned into the wind. Cloudbase and wind are refined by a weather model (**Open-Meteo**) when available, else estimated from the tracks. **Wave climbs** (straight, well above the terrain) are reconstructed too, as vertical **ribbons** — what the thermal (circling) detection misses. **Very approximate model** (see *Notes & limitations*).
- **Lift potential** *(opt-in, off by default, experimental)* — a physics estimate of **where the air rises**: **thermal** (sun × terrain slope × heat flux → w\*, with OSM land-cover albedo/Bowen and cast shadows), **slope lift** (wind × terrain) and **convergence** (wind × terrain curvature: air piling up at valley heads and confluences), each component is **toggled by a checkbox**, then the enabled ones are **balanced with a simplex mixer** whose shape follows their count (an axis for 2, a triangle for 3, a polygon beyond — thermal, slope, convergence, wave): the nearer a vertex, the more that component dominates. A warm (climbs) / blue (sinks) field draped on the terrain, colour-coherent across components. On a **cumulus day** the strongest thermal cores are topped with a **cumulus** at the cloudbase (none on a blue day). A **colour legend** in the panel maps the ramp to sink/lift, with a Vz anchor for the thermal. A **day-structure** panel (emagram: sounding, parcel, cloudbase, ceiling — with the convective depth and cu/blue) helps read the day. **Very approximate model** (see *Notes & limitations*).
- **Wind** *(opt-in, off by default, experimental)* — visualises the wind field, **local and terrain-refined**, resolved **by altitude** (Open-Meteo profile). A dropdown picks the representation: **Draped (2D)** in 3 variants (vectors, speed colours, or both), **Wind barbs (2D)** (met convention: half barb 5 kt, full 10 kt, pennant 50 kt), **Isotachs (2D)** (equal-speed contours + colour bands), **Altitude layers (3D)**, **Rings per altitude (3D)**, **Hodograph (3D)** (profile spiral → shear). A **rose** (corner) gives speed and source. **Very approximate** (see *Notes & limitations*).
- **Weather sandbox** *(opt-in, off by default)* — replace the fetched weather with a **synthetic atmosphere** (wind speed / direction / shear, stability N, surface temp) and a chosen **sun date/time**, to explore *what-if* situations — e.g. force a lee-wave day and watch the Onde bands, the day-structure emagram and the wave scan react. It feeds **every** physics model; a **⚠ simulated** badge marks the mode. Illustrative, not a forecast.

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

- **Air mass — a very rough, illustrative model** (neither measured nor predictive; not for flight planning):
  - *Thermals* — shown only where a glider actually **circled** (no traffic → nothing); their position and strength are the **glider's climb**, not the true air motion (no *netto*); weak or brief lift may be missed. **Wave climbs** (ribbons) are detected by the opposite — a sustained, **straight** climb above the terrain — and may mistake a long ridge run for wave.
  - *Cloudbase* — **estimated** (LCL from temperature/humidity, or a percentile of the tops), not measured: it can be off by hundreds of metres.
  - *Wind* — a **local** wind (coarse weather model at the view centre, or circle drift), **terrain-refined** (sheltering/deflection heuristic) and resolved **by altitude** from the profile; still coarse (ignores rotor, convergence, breezes, mass consistency). The 3D representations are **experimental**.
  - *Lift potential* — a **physics** estimate, not a measurement, overlaying the checked components. *Thermal* (w\*): approximate albedo/Bowen (OSM land-cover, unavailable if Overpass is down → uniform), with **cast shadows** from upwind relief but no cumulus shading or advection; an **ensemble mean**, sharpest at **low sun**. Its depth follows the **thermal ceiling** (a surface parcel vs the Open-Meteo temperature sounding, else the boundary-layer top) — deeper over low ground, **fading on a stable day** and stopping above the boundary layer. **View-independent** (a slope keeps its colour as the camera moves): warm tracks the **absolute** updraught strength (so a strong midday thermal reads red where it's strong), blue marks cells **below the flat-ground reference** (shaded / poorly-exposed faces) — **compensating subsidence** by mass continuity, not a measured downdraught. An opt-in **Calibrate on tracks** checkbox rescales its magnitude to the day's **observed climb rates** (a single day-scale factor) — off by default, since a global factor can dim favourable slopes that simply had no traffic. *Slope* (`w = wind · ∇terrain`, refined by an upwind-sheltering heuristic): a **first-order kinematic approximation** ignoring flow separation, rotor, lee waves and stability, with one wind for the whole scene and detail limited by the DEM; blue (sink) comes from **lee slopes**. *Convergence* (divergence of a terrain-deflected wind, normalised): a **kinematic** cue only — no thermal/breeze/synoptic convergence, no mass consistency, one wind for the scene; warm where the flow piles up (valley heads, confluences), blue in the lee.
- OGN tracks depend on ground-station reception — gaps and dropouts are possible.
- Attitude (bank/pitch) is **estimated** from ground track and speed, not measured.
- OGN keeps IGC tracks for only **~24 hours**, so older dates are often empty.
- Please respect the [OGN data usage policy](https://www.glidernet.org/ogn-data-usage/).

For the physics behind the air mass and lift potential (formulas, data, assumptions), see the [model reference](lift-model.md); the terrain classification and wave scan are in the [site-classification reference](site-classification.md).

The app is a client-side single-page app; source and issues on [GitHub](https://github.com/s-celles/ogn-3d-viewer).
