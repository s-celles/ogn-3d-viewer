// ============ shared mutable state ============
// All the app's mutable variables live here as properties of S so that every
// module reads/writes the same live values (ES module imports are read-only
// bindings, so plain `let` exports could not be reassigned across files).
import type { AppState, Lang } from './types';
import { MODEL_SCALE, GROUND_ZOOM_DEFAULT, TERRAIN_N, FAR_PLANE, DECK_CACHE, OVERVIEW_MINZOOM, DEFAULT_BASEMAP } from './config';
import { pickSettings, applyStored } from './settings';

const INIT = { longitude: 2.4, latitude: 46.6, zoom: 6, pitch: 0, bearing: 0, minZoom: OVERVIEW_MINZOOM, maxPitch: 85 };

/** UI language auto-detected from the browser locale (falls back to English). */
export function detectLang(): Lang {
  const l = (navigator.language || '').toLowerCase();
  return l.startsWith('fr') ? 'fr' : l.startsWith('de') ? 'de' : l.startsWith('es') ? 'es' : l.startsWith('it') ? 'it' : 'en';
}

export const S: AppState = {
  // filled by loadData / rebuild
  AF: null, G0: 0, G1: 0, SPAN: 1, TRACKS: [], ready: false,
  exo: 1.0, groundZoom: GROUND_ZOOM_DEFAULT, cacheScale: 1, altOffset: 0, cur: 0, playing: false, speed: 8, dir: 1, solo: null,
  mode: 'over', source: 'ogn', subject: null, focus: null, focusLock: null, fpvPitch: 6, fpvFollow: true, bank: true, freeCam: { bearing: 0, pitch: 6 },
  chase: { az: 0, el: 17, dist: 25 },
  trace: 'window', trailFx: 'basic', modelScale: { ...MODEL_SCALE }, windowMin: 10, spline: true, compensated: true, sound: true, trafficMode: 'directional', graphMode: 'off',
  glideCone: false, glideRatio: 10, safetyHeight: 0, coneRadiusKm: 25,
  labels: false, labelFields: { reg: true, alt: true, speed: false, vario: false, hdg: false },
  shadowMode: 'off', altCurtain: false, showAttribution: true, basemap: DEFAULT_BASEMAP, ignDem: false,   // experimental, opt-in
  showPeaks: false, peakDensity: 0.35, minimap: true, overviewHud: false, activeOnly: false, airMass: false, windMode: 'off', heightRef: 'af', clockUTC: false, clock12: false,
  live: false, liveTimer: null,
  INIT: { ...INIT },
  mapVS: { ...INIT },
  mapTarget: { ...INIT },
  // source tracks (path times = UTC seconds of day). RAW is the merge target for
  // live refreshes; rebuild() turns it into the render-ready TRACKS.
  RAW: [], CURAF: null, CURTZ: 0, date: '',
  COLOR: {}, colorN: 0,
  // current UI language (fr/en/de/es/it); langAuto = follow the browser locale.
  lang: detectLang(), langAuto: true,
  // developer mode (enabled with ?dev=1); tuners default to the normal values
  dev: {
    on: false, wireframe: false, noTexture: false, skirts: true, tileBounds: false,
    fps: false, counters: false, maxRequests: 12, gridN: TERRAIN_N, farKm: Math.round(FAR_PLANE / 1000), deckCache: DECK_CACHE,
  },
  // current terrain TileLayer instance (rebuilt when exaggeration changes)
  terrainInst: null,
};

// Snapshot the built-in defaults BEFORE applying any persisted overrides, so a
// reset can restore them; then merge in the user's saved settings (if any). This
// runs at module load, before the UI reads S, so controls init to stored values.
export const DEFAULT_SETTINGS = pickSettings(S);
applyStored(S);
if (S.langAuto) S.lang = detectLang();   // "Auto": always follow the current browser locale
// ?dev=1 enables developer mode (?dev=0 disables); otherwise the persisted value
// stands, so it stays on across reloads once turned on.
const devParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('dev') : null;
if (devParam != null) S.dev.on = devParam !== '0';
