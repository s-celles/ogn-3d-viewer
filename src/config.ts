// ============ config ============
import type { RGB, Mode } from './types';

// FlightBook exposes open CORS (access-control-allow-origin: *): direct calls are possible.
export const API_BASE = 'https://flightbook.glidernet.org';
// Public source repository, linked from the info panel.
export const REPO_URL = 'https://github.com/s-celles/ogn-3d-viewer';
export const PALETTE: RGB[] = [
  [255, 140, 0], [60, 180, 255], [160, 120, 255], [120, 230, 120], [255, 90, 160],
  [250, 210, 70], [80, 220, 210], [235, 120, 90], [150, 200, 255], [200, 160, 120],
];

export const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Base map draped over the 3D terrain. Each provider must serve CORS-enabled
// tiles (we fetch + decode them into a WebGL texture). `imgMax` caps the request
// zoom to the provider's deepest level (beyond it deck keeps a coarser parent).
// `credit` is the imagery attribution HTML shown next to the terrain credit.
export interface Basemap { url: string; label: string; imgMax: number; credit: string; }
export const BASEMAPS: Record<string, Basemap> = {
  esri: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    label: 'Esri (satellite)', imgMax: 19,
    credit: "<a href='https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9' target='_blank' rel='noopener'>Esri World Imagery</a> (Esri, Maxar, Earthstar Geographics)",
  },
  opentopo: {
    url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    label: 'OpenTopoMap', imgMax: 17,
    credit: "© <a href='https://opentopomap.org/' target='_blank' rel='noopener'>OpenTopoMap</a> (CC-BY-SA) · © <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap</a> contributors",
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    label: 'OpenStreetMap', imgMax: 19,
    credit: "© <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap</a> contributors",
  },
};
export const DEFAULT_BASEMAP = 'esri';
export const TEXTURE = BASEMAPS.esri.url;   // Esri stays the source for the Discover-spots preview map

export const TERRAIN_N = 128; // mesh grid per tile (bilinear DEM sampling → denser = finer relief, esp. with the IGN DEM)

// IGN RGE ALTI (fed by LIDAR HD) — a much finer DEM over France, keyless and
// CORS-enabled, served as BIL float32 by the Géoplateforme WMS-raster. We request
// it per tile in EPSG:3857 so it aligns with our web-mercator tiles, decode the
// float32 in JS (like Terrarium), and fall back to Terrarium per pixel on the
// -99999 nodata sentinel (sea / outside coverage). No hosting or pre-tiling.
export const IGN_DEM_PX = 256;   // BIL tile size: > the mesh grid so bilinear oversamples it → smooth (no mesh-facet terracing)
export const IGN_DEM_WMS = `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&CRS=EPSG:3857&FORMAT=image/x-bil;bits=32&WIDTH=${IGN_DEM_PX}&HEIGHT=${IGN_DEM_PX}`;
// IGN BD ORTHO (20 cm aerial imagery over France) — keyless WMTS in Web Mercator
// (TileMatrixSet PM = our z/x/y), so it drapes like any basemap. Used per tile
// where the tile is fully inside France; the chosen basemap covers the rest.
export const IGN_ORTHO = 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';
export const IGN_CREDIT = "© <a href='https://geoservices.ign.fr/' target='_blank' rel='noopener'>IGN</a> — RGE ALTI / LIDAR HD · BD ORTHO";
export const IGN_DEM_MINZOOM = 8;    // below this the tile bbox is too wide for a 256px BIL to help
export const IGN_DEM_MAXZOOM = 15;   // RGE ALTI (~1 m native) stays sharp up to here and beyond
// Where RGE ALTI HIGHRES exists (metropole + DROM), lon/lat [w, s, e, n]. Generous
// rectangles — the per-pixel nodata fallback cleans up sea / foreign edges.
export const IGN_COVER: [number, number, number, number][] = [
  [-5.3, 41.2, 9.8, 51.3],     // métropole + Corse
  [-61.9, 15.7, -60.9, 16.6],  // Guadeloupe
  [-61.3, 14.3, -60.7, 14.95], // Martinique
  [-54.7, 2.0, -51.5, 6.0],    // Guyane
  [55.1, -21.5, 55.9, -20.8],  // La Réunion
  [45.0, -13.1, 45.4, -12.6],  // Mayotte
  [-56.5, 46.7, -56.1, 47.2],  // Saint-Pierre-et-Miquelon
];

// Per-device streaming budget. deck.gl's TileLayer loads the whole scene at a
// single zoom level, so a deep first-person frustum (out to the horizon) asks
// for thousands of tiles — far more than any cache holds, so the distance never
// finishes loading. We keep the near ground sharp (full zoom) everywhere and
// instead cap how FAR the camera sees, tuned to the device: phones (deviceMemory
// ≤4, or undefined on Safari) get a modest cache and a short view distance so the
// visible tiles fit; desktops (≥8 GB) get a big cache and a long view distance.
export const DEVICE_GB = (typeof navigator !== 'undefined' && (navigator as any).deviceMemory) || 4;
export const ROOMY = DEVICE_GB >= 8;
export const DECK_CACHE = ROOMY ? 800 : 300;    // deck's decoded-tile LRU (render)
export const ELEV_CACHE = ROOMY ? 1000 : 400;   // our elevation-lookup FIFO
export const DISK_TILES_BASE = ROOMY ? 4000 : 800;  // service-worker tile cache (matches build.ts)
// User cache-size multiplier (S.cacheScale) applied to the above. RAM caches are
// ~256 KB/tile so they're capped to ×2 to avoid running the tab out of memory;
// the disk cache (~30 KB/tile, browser-evicted under pressure) scales in full.
export const ramCacheFactor = (scale: number): number => Math.min(scale, 2);
export const FAR_PLANE = ROOMY ? 130000 : 70000; // first-person/chase frustum far (m)

// The Terrarium elevation DEM (AWS) only exists up to zoom 15. The ground-detail
// setting (S.groundZoom) can go beyond that: the mesh geometry is capped at this
// DEM ceiling, but the Esri imagery is sampled at the full requested zoom and
// draped over the (overzoomed) mesh — so the photo keeps sharpening past z15.
export const DEM_MAXZOOM = 15;
export const GROUND_ZOOM_MIN = 13, GROUND_ZOOM_MAX = 18, GROUND_ZOOM_DEFAULT = 15;

// Traffic-awareness radar (focus views): show other airborne aircraft within
// `range` m of the subject, track-up. Threat levels by horizontal/vertical
// separation — alert (close) and warn (proximate).
export const TRAFFIC = {
  range: 8000,            // radar plan-view range (situational awareness)
  proximity: 3000,        // directional view shows non-threat traffic only within this
  warn: { h: 1500, v: 250 },
  alert: { h: 500, v: 100 },
};

// OGN reception loss: a gap between consecutive beacons longer than
// max(GAP_MIN, GAP_FACTOR × the track's median beacon interval) is treated as a
// reception loss (the track is interpolated across it and drawn dashed).
export const GAP_MIN = 20, GAP_FACTOR = 6;

// navigation clamps
export const MINZ = 8.5, MAXZ = 14.5, PMIN = 0, PMAX = 85;
// Hard floor for the overview map zoom (deck clamps the controller to the
// viewState's minZoom). Zooming out further turns the flat web-mercator terrain
// into a continent-to-horizon plane (a flat-Earth look); ~z6 still frames any
// real flight, and worldwide sites are reached via "Discover spots" instead.
export const OVERVIEW_MINZOOM = 6;
export const clampv = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Glider attitude (display). Bank is derived from the coordinated-turn relation
// tan(roll) = V·ω / g (turn rate × ground speed). Pitch is set by AIRSPEED, not
// climb rate: a glider is always descending through the air, so unlike a powered
// aircraft it never holds a nose-up attitude in normal flight — it flies ~level
// near stall and increasingly nose-down as it speeds up. Both angles are CAPPED
// by the max below so noisy OGN tracks can't produce absurd attitudes. halfSpan /
// halfLen are the on-screen marker half-sizes in metres (a readable glyph, not
// the real 15 m wingspan).
export const GLIDER = {
  maxBankDeg: 55,   // max |roll|
  maxPitchDeg: 35,  // max |pitch|
  g: 9.81,          // gravity (m/s²)
  halfSpan: 150,    // wing marker half-span (m)
  halfLen: 110,     // fuselage marker half-length (m)
  wingPos: 0.35,    // where the wings cross the fuselage, as a fraction of halfLen
                    // ahead of the position (0 = centre, 1 = at the nose)
  dt: 3,            // ± window (s) for speed / turn-rate estimation
  pitchLevelSpeed: 19,  // m/s (~68 km/h, near stall): body attitude ≈ level
  pitchGain: 0.0085,    // rad of nose-down per m/s of speed above pitchLevelSpeed
};

// Chase cam: a FirstPersonView orbiting the subject aircraft. The viewpoint is
// spherical relative to the aircraft — az0 (orbit, 0 = behind), el0 (elevation
// above), dist0 (slant range, m) — chosen so the real (~15 m span) aircraft —
// drawn at true size in chase, not the ×16 overview marker — frames at roughly a
// third of the screen. The *Step / *Min / *Max bound the on-screen nudge
// controls. `fovy` is the vertical field of view.
export const CHASE = {
  fovy: 64,
  az0: 0, el0: 17, dist0: 25,
  azStep: 25,
  elStep: 8, elMin: -10, elMax: 80,
  distStep: 1.2, distMin: 10, distMax: 200,
};

// Glider position marker: a heading-oriented triangle (metres). `len` is the
// nose distance ahead of the position, `back` the base behind it, `halfW` the
// half-width of the base.
export const ARROW = { len: 150, back: 65, halfW: 80 };

// Scale factor applied to the (metre-sized) 3D aircraft meshes, per view (user
// adjustable at runtime via S.modelScale). The overview inflates them into a
// readable marker (their true ~15 m span would be near-invisible on the map);
// cockpit and chase draw nearby traffic at true size (1) for a lifelike view.
// The chase camera distances (CHASE) are tuned to this chase scale.
export const MODEL_SCALE: Record<Mode, number> = { over: 16, fpv: 1, chase: 1 };

// Live mode: the cursor is real time, always a little ahead of an aircraft's
// latest OGN beacon, so aircraft are frozen at their last-known fix. A fix newer
// than onlineMaxAge is "online" (full colour); an older one still shows as
// "offline" (dimmed, like the FlightBook live map) until offlineMaxAge, after
// which the aircraft is treated as landed / gone and hidden.
export const LIVE = {
  onlineMaxAge: 90,     // s since last beacon to still count as online
  offlineMaxAge: 1800,  // s since last beacon still shown dimmed; older = hidden
};
