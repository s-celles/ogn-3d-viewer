# Air mass & lift-potential model — technical reference

This document describes how OGN 3D Viewer reconstructs the day's **air mass** and
estimates the **lift potential** (where the air rises), the physics behind each
component, the data it uses, and its limitations.

> **These are illustrative, first-order diagnostics — not measurements and not a
> forecast.** They are meant to *build intuition* about a day, not to plan a flight.
> Every model here is deliberately simple and makes strong assumptions (see
> *Limitations*). Treat the output as a sketch, always subordinate to real
> observation and official meteorology.

All of it runs 100 % client-side in the browser.

## Contents

- [Data sources](#data-sources)
- [Air mass — reconstruction from tracks](#air-mass--reconstruction-from-tracks)
- [Lift potential — a physics estimate](#lift-potential--a-physics-estimate)
  - [Thermal](#thermal-thermalts)
  - [Slope lift](#slope-lift-ridgets)
  - [Convergence](#convergence-convergts)
  - [Wave](#wave-wavets)
  - [Calibration against the tracks](#calibration-against-the-tracks-calibts)
- [The mixer](#the-mixer-liftts--liftmixerts)
- [Wind field](#wind-field-ridgets)
- [Colour language](#colour-language-liftvizts)
- [Day-structure panel](#day-structure-panel-daystructts)
- [Design principle: view independence](#design-principle-view-independence)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

## Data sources

| Source | Used for | Notes |
| --- | --- | --- |
| **Terrain DEM** (`terrain.ts`, `terrainElevAt`) | slope, aspect, curvature, cast shadows, convective depth | synchronous mesh sample; refines as tiles stream in |
| **Sun geometry** (`sky.ts`, `sunLightDir`) | incidence on each facet, cast-shadow direction | ENU unit vector toward the sun |
| **Open-Meteo** (`weather.ts`, keyless) | radiation, boundary-layer height, temperature sounding, wind profile, cloudbase | forecast API ≤ 5 days, ERA5 archive beyond; offline-first |
| **OSM land-cover** (`landcover.ts`, Overpass) | per-cell albedo & Bowen ratio | offline-first; uniform fallback when Overpass is down |
| **OGN tracks** | the reconstructed air mass (circling detection) | the only *observed* input |

## Air mass — reconstruction from tracks

`airmass.ts` treats each glider as an atmospheric probe: **where one circles while
climbing, the air is rising.**

1. **Detect circling-climb runs** in every track: a smoothed turn rate over a
   threshold, with brief interruptions bridged so one climb stays one thermal.
   Kept only if it sweeps ≥ 1 full turn (`MIN_TURN = 360°`), climbs ≥ `MIN_GAIN = 80 m`
   and averages ≥ `MIN_STRENGTH = 0.3 m/s` — this rejects ridge S-turns.
2. **Merge** thermals from different gliders that overlap in time and lie within
   `MERGE_M = 500 m` (the same air, seen by several aircraft).
3. **Render** each as a slim wind-leaned **plume** capped by a **cumulus** at a common
   **cloudbase**, fading in/out as the day is scrubbed. Dry thermals (top well below
   cloudbase) stay cloudless. Up to `MAX_THERMALS = 60`, strongest first.

**Cloudbase** is the LCL from surface T and RH (`weather.ts`, `lclBase`): about
`125 m` per °C of temperature/dew-point spread above the field, else a high percentile
of the observed climb tops. **Wind** for the lean comes from the Open-Meteo profile at
mid-plume height, else the circle drift.

**Observed wave** (`wavemass.ts`) is the mirror image: a thermal climb circles, a wave
climb is smooth and nearly **straight**. Where the thermal detector needs ≥ 1 full turn,
this one keeps sustained climbs with a **low turn rate** (`< 3.2°/s`), net heading under
`300°`, and a top well above the terrain (`≥ 250 m AGL`, excluding ridge beats). Each
becomes a vertical **violet ribbon** (a wave bar) aligned with the climb heading, shown
under the same *Air mass* toggle. So on a wave day — when the thermal reconstruction is
nearly empty — the lee-wave lift still shows.

> The plume *position and strength are the glider's climb*, not the true air motion
> (no netto). Weak or brief lift is missed; no traffic → nothing shown.

## Lift potential — a physics estimate

`render.ts` draws, under one toggle, up to three independent components, each with its
own renderer, blended by [the mixer](#the-mixer-liftts--liftmixerts). All share one
[colour ramp](#colour-language-liftvizts): **warm = rising, blue = sinking.**

### Thermal (`thermal.ts`)

The convective updraught over sun-heated ground, on an 80×80 grid draped on the terrain.

**1. Absorbed sensible heat flux** at each cell:

```
H = (DNI · cos(inc) · shade + diffuse) · (1 − albedo) · β
```

- `DNI` (direct normal irradiance) is derived from Open-Meteo shortwave/diffuse
  radiation — so it already accounts for **cloud attenuation**.
- `cos(inc)` is the sun's incidence on the local slope (DEM aspect × sun geometry).
- `albedo` and `β` (sensible-heat / Bowen fraction) come from OSM land-cover per cell,
  else uniform defaults `ALBEDO = 0.2`, `β = BETA = 0.35`.
- `shade` ∈ [0,1] is the **cast shadow**: a grid-space horizon march toward the sun —
  if upwind terrain rises above the sun line, the direct beam is blocked (diffuse only).
  Soft edge over ~3.5°. Skipped when the sun is near the zenith.

**2. Convective velocity scale** (Vz ≈ 0.6·w\*):

```
Vz = 0.6 · [ (g/θ) · (H / ρcp) · z_i ]^(1/3)
```

with `g = 9.81`, `θ = THETA = 290 K`, `ρcp = RHOCP = 1200 J/m³K`.

**3. Convective depth `z_i`** is the **thermal ceiling minus the cell's ground height**
(clamped to `[0, 3500] m`; cells within 100 m of the ceiling are dropped). The ceiling
(`weather.ts`, `weatherConvTop`) is where a surface parcel — ambient + a small excess
`TRIGGER_EXCESS = 1.5 K` — rising at the dry-adiabatic lapse rate `DRY = 0.0098 K/m`
meets the Open-Meteo **temperature sounding** (925/850/700 hPa + surface). It falls back
to the boundary-layer top, then a constant offline. Consequences: thermals are **deeper
over low ground**, **fade on a stable day**, **stop above the boundary layer**, and
**strengthen through the afternoon** as the ceiling lifts.

**4. Colouring** (view-independent, fixed thresholds):

- A **flat reference** `wRef` = Vz of flat reference ground under the same sun/weather.
- **Warm** where `Vz ≥ wRef`, by absolute strength `f = Vz / W_FULL` (`W_FULL = 1.5 m/s`
  → full red), entry at `WARM_MIN = 0.30`. So a strong midday thermal reads red *where
  it is strong*, not only where aspect beats the average.
- **Blue** where `Vz < wRef`, by the deficit `(wRef − Vz) / scaleRef` — shaded / poorly
  exposed faces: the **compensating subsidence** required by mass continuity (not a
  measured downdraught). Entry at `SINK_MIN = 0.12`.

**5. Cumulus vs blue.** Cloud forms when dry convection (the ceiling) reaches the
**LCL** (cloudbase, `weatherCloudbase`). On a **cu day** (`ceiling ≥ cloudbase`) the
strongest thermal cores are marked with a **cumulus** at the cloudbase (thinned, capped
at 60, skipped where terrain pokes through the base); a **blue day**
(`ceiling < cloudbase`) gets none.

### Slope lift (`ridge.ts`)

Slope lift is wind deflected by the ground, so it is **predicted** from the DEM and the
wind — everywhere, with or without traffic:

```
w = (wind · ∇terrain) · shelter
```

`shelter` ∈ [0.2, 1.4] refines the wind with the terrain: higher ground the upwind
distance `LU = 900 m` away shelters a cell (`H_SHELTER = 320 m` → ~fully sheltered),
an exposed windward crest keeps or boosts it. Windward (`w > 0`) is warm, leeward
(`w < 0`) blue; drawn above `W_MIN = 0.4 m/s`; calm wind (< 1.5 m/s) → nothing. Patches
are tilted to the slope so the bands lie on the ground.

### Convergence (`converg.ts`)

Where the wind, deflected by terrain, **piles up** it must rise — at valley heads,
bowls and confluences facing the flow; in the lee it spreads (sink). Distinct from slope
lift because it responds to terrain **curvature**, not gradient:

1. Deflect a uniform background wind around the DEM by removing its into-slope
   component: `V = V₀ − α · max(0, V₀·ĝ) · ĝ` with `ALPHA = 0.85`. A planar slope only
   turns the flow; where slopes converge the flow decelerates.
2. Drape the horizontal **divergence** `∂u/∂x + ∂v/∂y`, normalised by `step / |wind|`
   (dimensionless, view-independent). Convergence = −divergence: warm where it piles up
   (entry `CONV_MIN = 0.05`), blue in the lee. Light 3×3 blur (curvature is noisy).

### Wave (`wave.ts`)

Lee (mountain) waves: a stable airstream crossing a ridge with enough wind oscillates
downwind as a standing wave — smooth lift in the crests, sink in the troughs — at

```
λ = 2π·U / N        (U = cross-ridge wind, N = Brunt–Väisälä frequency)
```

`N` comes from the upper sounding layer (`weatherStability`; NaN if neutral/unstable);
`U` from the wind profile. We take the terrain forcing along the wind
(`w₀ = wind·∇terrain`) and **convolve the upwind profile with a decaying resonant
sinusoid** at the Scorer wavenumber `l = N/U` — a linear lee-wave response draped on the
terrain (warm crests, blue troughs). Gated: wind ≥ `WIND_MIN = 7 m/s`, `N > N_MIN`, and
`λ ∈ [2.5, 22] km`; otherwise nothing. **Off by default** (the mixer's 4th vertex,
enabled by its checkbox) since it only applies on windy, stable days.

A companion **worldwide wave scan** (`wavescan.ts`, the Discover **🌊** tab) ranks every
spot for a date on four ingredients: the same **U / N / λ** test, plus the site's actual
**relief** (a batched Open-Meteo *elevation ring* — flat sites are dropped) and whether
the **wind crosses a ridge** (the relief seen *along the wind* — this handles a site with
several ridges in different orientations, since it only asks that the wind meet some of
them). *Weather first, then pick the field.* And **observed wave** climbs are
reconstructed from the tracks (see [Air mass](#air-mass--reconstruction-from-tracks)).

### Calibration against the tracks (`calib.ts`)

The thermal field's absolute scale (`W_FULL`) is only a guess — but the day's tracks
give **real climb rates** (`airmass.ts`). So we predict Vz at each detected thermal's
place and time with the same physics (uniform land-cover, no shadow — a point estimate),
take the **robust median of `observed climb / predicted Vz`** (needs ≥ 4 thermals,
clamped to `[0.4, 3.5]`), and multiply the whole thermal field by it. Red then means
*"as strong as the day's best real climbs"*. It is a single **global factor** — it
changes how strong the day reads, not the spatial pattern — memoised on the track set,
date and weather-readiness; `1` (no change) for imported files or too few thermals.

> **Opt-in, off by default** (a "Calibrate on tracks" checkbox). Because it is a global
> factor, on a day where the model over-predicts vs the observed climbs it dims the
> *whole* field — including favourable slopes that simply had no traffic. Left off, the
> field keeps its fixed physical scale so every good slope reads on its own merit.

> The target is the glider's **climb**, not netto (no polar-sink correction yet), so the
> scale is in achievable-climb terms.

## The mixer (`lift.ts` / `liftmixer.ts`)

Components live in one registry `LIFT_COMPS` (`lift.ts`): `thermal`, `slope`,
`converg` — each with an i18n label and a swatch colour. Two pieces of state
(`state.ts`): `liftOn[]` (a checkbox per component — whether it is a vertex of the
mixer) and `liftMix[]` (the blend weight per component, Σ = 1 over the enabled ones,
scaling that component's opacity).

The enabled components form a **simplex**, and the draggable point's
**generalized-barycentric coordinates** are the weights:

- 2 enabled → a point on an **axis**;
- 3 enabled → a point in a **triangle**;
- N enabled → a regular **N-gon** (mean-value coordinates, Floater).

Dragging outside the simplex clamps to the nearest edge (so the handle stays on the
side dragged toward). A ↺ button resets to an equal split. Adding a new component
(e.g. **wave**) is one entry in `LIFT_COMPS` + a renderer in `render.ts`: the mixer
grows a vertex on its own.

## Wind field (`ridge.ts`)

`windAtAlt(lat, lon, alt)` returns the wind [east, north] at an AMSL altitude: the
Open-Meteo profile at the view centre (bucketed ~10 km), else at the airfield, else the
mean thermal drift. `windBg` samples it ~400 m above the local surface; `shelterScale`
exposes the terrain-sheltering factor. This one field feeds slope lift, convergence and
the wind visualisation.

## Colour language (`liftviz.ts`)

A single ramp shared by every component so lift reads the same everywhere:
`LIFT_COLORS` (5 warm steps, green → red = stronger lift) and `SINK_COLORS` (3 cool
steps, light → deep blue = stronger sink). Thermal uses all 5 warm + 3 cool; slope and
convergence use a 3-warm / 3-cool subset. A **legend** of this ramp is shown in the lift
panel (below the mixer), with an approximate Vz anchor for the thermal component
(green ≈ 0.5, yellow ≈ 0.9, red ≥ 1.4 m/s at the nominal scale).

## Day-structure panel (`daystruct.ts`)

Below the mixer (when the lift potential is on and a sounding is available), a compact
**emagram** at the current hour with a ground/top altitude scale: the environmental
temperature sounding (orange), the surface parcel's dry adiabat (yellow — its crossing
sets the ceiling), the **cloudbase** (LCL, blue dashed) and the **thermal ceiling**
(dashed), plus a one-line summary (convective depth, **cumulus vs blue**). It redraws
only when the hour, weather or day type changes.

The sounding is shallow (925/850/700 hPa), so when the parcel is still buoyant at the
top of the data the ceiling is reported as `≥` that altitude (the fair-weather inversion
is often above 700 hPa). And because the parcel starts from the **instantaneous** surface
temperature (no diurnal decay), a late-afternoon residual mixed layer — near
dry-adiabatic — reads as a deep ceiling even as real thermals are dying. See *Limitations*.

## Design principle: view independence

Colours must depend only on **the physics at a location**, never on what is currently on
screen. An earlier version normalised the thermal field against the cells in view (median
split, per-view percentile) — panning then flipped a slope's colour. The current model
uses a **global reference** (`wRef`) and **fixed physical thresholds**, so a given slope
keeps its colour as the camera moves. Convergence is likewise normalised by a global
scalar. Grids are cached per view (centre, radius, ~15-min time bucket) and rebuilt as
fresh deck layer instances each frame.

## Limitations

- **Not measured, not predictive.** First-order diagnostics with strong assumptions;
  do not use for flight planning.
- **Thermal**: approximate albedo/Bowen (uniform if Overpass is down); no cumulus
  shading of the ground, no advection; an ensemble mean. The blue sink is *relative*
  (its absolute strength is not calibrated). **No diurnal history**: the flux and the
  ceiling use the *instantaneous* surface temperature, so morning warm-up and evening
  collapse are not modelled — a late-afternoon residual layer can read as a deep,
  still-working day.
- **Thermal ceiling**: from a shallow sounding (925/850/700 hPa), so a cap above 700 hPa
  is missed and the ceiling is reported `≥` the data top; the parcel excess is a fixed
  `1.5 K`.
- **Slope lift**: a kinematic `w = wind·∇terrain` — ignores flow separation, rotor, lee
  waves and stability; one wind for the whole scene; detail limited by the DEM.
- **Convergence**: kinematic terrain-deflection cue only — no thermal/breeze/synoptic
  convergence, no mass consistency, one wind for the scene.
- **Wave**: a linear 2D lee-wave response — one wind/stability for the scene, no
  trapping/resonance modes, no rotor, phase and amplitude only indicative; draped in the
  horizontal (not the true elevated wave bars).
- **Air mass**: shows only where a glider circled; strength is the glider's climb, not
  netto; cloudbase is estimated (LCL), off by hundreds of metres possible.
- **Weather**: a coarse model at the view centre; the sounding/BL height can be
  unreliable over complex terrain.

## Roadmap

- **Diurnal accumulation / decay** — integrate the day's heating instead of the
  instantaneous flux, so mornings ramp up and evenings collapse (fixes the deep
  late-afternoon ceiling).
- **Netto** — subtract the glider's polar sink from the observed climb for a truer air
  Vz (would also sharpen the [calibration](#calibration-against-the-tracks-calibts)).
- **Local assimilation** — nudge the field toward the observed climbs *spatially*, not
  just a global scale.
- **Dewpoint profile** — fetch humidity aloft to draw Td on the day-structure emagram
  (currently only the surface dewpoint / LCL is known).

---

Source and issues on [GitHub](https://github.com/s-celles/ogn-3d-viewer). See also the
user guide: [English](features.en.md) · [Français](features.fr.md) ·
[Deutsch](features.de.md).
