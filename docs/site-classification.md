# Site terrain classification & worldwide wave scan — technical reference

This document describes how OGN 3D Viewer characterises each gliding **site by its
terrain** (plain / hills / mountain / high mountain) and how the **🌊 wave scan** ranks
sites by mountain-wave potential for a date. It complements the physics of the in-scene
lift models in the [model reference](lift-model.md).

> Like the lift models, these are **illustrative pre-selection tools**, not a substitute
> for real soaring forecasts or local knowledge.

## Contents

- [Data source: the DEM tiles](#data-source-the-dem-tiles)
- [Relief measurement](#relief-measurement)
- [Terrain classification (Kapos/Meybeck)](#terrain-classification-kaposmeybeck)
- [Worldwide wave scan](#worldwide-wave-scan)
- [In the UI](#in-the-ui)
- [Persistence](#persistence)
- [Limitations](#limitations)
- [References](#references)

## Data source: the DEM tiles

Elevation is sampled (`dem.ts`, `demElev`) from the **Terrarium DEM tiles** — the very
tiles the 3D terrain uses (`elevation-tiles-prod` on AWS, a public CDN, no metered API),
decoded in pure JS with UPNG. Elevation from a Terrarium pixel is

```
elevation = R·256 + G + B/256 − 32768   (metres)
```

Sampling uses zoom **z = 11** (~20 km tile, ~76 m pixel). Tiles are cached in memory, so
a cluster of nearby sample points costs a single fetch. This replaced an earlier
Open-Meteo elevation API that was metered per point and rate-limited.

## Relief measurement

Around each site (`wavescan.ts`, `ensureRelief`) we sample the centre plus **concentric
rings** at `RINGS_KM = [4, 8, 12, 20, 28]` km, `RING = 8` azimuths each (41 points/site).
From those samples:

| Quantity | Definition | Used for |
| --- | --- | --- |
| `c` | centre ground elevation (AMSL) | the site's base altitude |
| `ler` | **local elevation range** = max−min within `LER_KM = 12` km | terrain class (plain/hills/mountain) |
| `top` | highest elevation within ≤ 28 km (AMSL) | "high mountain" test |
| `relief` | **wide** range = max−min within ≤ 28 km | wave reach (mountains within gliding distance) |
| `rings` | the ring elevations (kept) | the wave scan's *along-wind* relief |

The denser inner sampling (rings at 4/8/12 km) makes the LER robust: a valley floor
ringed by peaks (e.g. Jelenia Góra) reads its true relief instead of an undersampled ~0.

## Terrain classification (Kapos/Meybeck)

The static terrain tag (`siteTerrain`) follows the geomorphological practice of combining
a **local relief** measure with **absolute altitude** (see [references](#references)):

| Class | Rule | Tag |
| --- | --- | --- |
| **Plain** | `ler < 150 m` | 🌾 |
| **Hills** | `150 ≤ ler < 300 m` | 🏞 |
| **Mountain** | `ler ≥ 300 m` and `top < 2500 m` | ⛰ |
| **High mountain** | `ler ≥ 300 m` and `top ≥ 2500 m` | 🏔 |

- The `ler` thresholds (150 / 300 m) are in the range used by **Hammond** and the
  **Kapos/UNEP** local-elevation-range criterion for hills vs mountains.
- `HIGH_ALT = 2500 m` is the **Kapos** absolute-elevation threshold above which terrain is
  mountainous regardless of slope — here it separates mid mountains from the high,
  glaciated/periglacial belt. Using the region's **peak** altitude (`top`, within 28 km)
  rather than the valley floor keeps deep alpine valleys (Barcelonnette, base ~1130 m,
  peaks ~2960 m) correctly in *high mountain*.

Verified on the DEM: Niort/Arnborg → plain, Aalen → hills, Saint-Auban/Jelenia
Góra/Gap-Tallard/El Calafate → mountain, Barcelonnette → high mountain.

**Wave is not a terrain class** — it is weather-dependent. `isWaveSite` (which sites the
🌊 tab lists) is decoupled: `relief ≥ WAVE_REACH = 500 m` — i.e. mountains within ~28 km,
so a basin below a range still qualifies.

## Worldwide wave scan

For a date, `scanWaveSites` scores every spot for lee-wave potential from **four
ingredients**, taking the best hour of the day:

1. **Cross-ridge wind** `U` — mean of the 850/700 hPa wind (Open-Meteo, one batched
   multi-location request). `windF` ramps from `U_MIN = 8` to `U_FULL = 20 m/s`.
2. **Static stability** `N` — the Brunt–Väisälä frequency from the 850/700 hPa
   temperature gradient (`dθ/dz`). `stabF` ramps from `N_MIN = 0.006` to `N_FULL = 0.014`.
   Neutral/unstable → 0.
3. **Plausible wavelength** `λ = 2π·U/N` must lie in `[2.5, 22] km`.
4. **Terrain**: the site's `relief` (`RELIEF_MIN = 250 → RELIEF_FULL = 1100 m`, flat sites
   drop to 0) × whether the **wind crosses a ridge** — the relief seen *along the wind*
   across all rings, so a site with several ridges in different orientations is handled
   (it only asks that the wind meet some of them).

`score = windF · stabF · alignF · reliefF` (0–1). The predicted wavelength `λ` and the
best-hour wind are reported.

This is the *predicted* side. The [model reference](lift-model.md#wave-wavets) covers the
in-scene **Onde** lift component (drawn on the terrain) and the **observed wave**
reconstructed from tracks (`wavemass.ts`, violet ribbons under *Air mass*).

## In the UI

- **Terrain tags** appear on every row of the Discover lists (World, continents) and the
  🔥 hot-spots list, filled in progressively as the DEM scan resolves.
- A **terrain filter** (plain / hills / mountain / high mountain) sits next to the country
  and text filters; it filters both the list and the map markers.
- The **🌊 tab** always lists the wave-reach sites, each tagged with the **day's chance**:
  `score ≥ 0.45` → *workable*, `≥ 0.2` → *possible*, else *low*. It is never empty just
  because there is no wave right now.

## Persistence

The relief of each site is **static**, so it is persisted in `localStorage`
(`ogn.relief.v2`): computed once ever, then tags appear instantly and no DEM tiles are
re-sampled on later visits. The weather (wind/stability) is re-fetched per date.

## Limitations

- The DEM sampling is a **ring approximation** of the local relief, at ~76 m pixel — a
  pre-selection filter, not a survey. Distant or between-ring ridges can be under- or
  over-weighted.
- The wave scan uses **one wind/stability profile** per site (the coarse model at its
  coordinates), no trapping/resonance modes, no rotor; the score is a rough favourability
  index, not a forecast.
- Class boundaries (`150 / 300 m`, `2500 m`) are conventional and tunable; real terrain
  sits on a continuum.

## References

- **Hammond, E. H. (1964).** *Analysis of properties in land form geography: an
  application to broad-scale land form mapping.* Annals of the Association of American
  Geographers 54(1). — local relief within a ~9.6 km radius + gentle-slope fraction.
- **Meybeck, M., Green, P., Vörösmarty, C. (2001).** *A new typology for mountains and
  other relief classes.* Mountain Research and Development 21(1). — global relief typology
  from a DEM (median elevation × relief roughness).
- **Kapos, V., Rhind, J., Edwards, M., Price, M. F., Ravilious, C. (2000).** *Developing a
  map of the world's mountain forests.* — the UNEP-WCMC mountain definition combining
  absolute elevation and local elevation range (7 km), widely used by the FAO.

---

Source and issues on [GitHub](https://github.com/s-celles/ogn-3d-viewer). See also the
[model reference](lift-model.md) and the user guide
([en](features.en.md) · [fr](features.fr.md) · [de](features.de.md)).
