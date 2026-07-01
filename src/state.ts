// ============ shared mutable state ============
// All the app's mutable variables live here as properties of S so that every
// module reads/writes the same live values (ES module imports are read-only
// bindings, so plain `let` exports could not be reassigned across files).
import type { AppState, Lang } from './types';
import { MODEL_SCALE } from './config';
import { pickSettings, applyStored } from './settings';

const INIT = { longitude: 2.4, latitude: 46.6, zoom: 4.6, pitch: 0, bearing: 0, maxPitch: 85 };

export const S: AppState = {
  // filled by loadData / rebuild
  AF: null, G0: 0, G1: 0, SPAN: 1, TRACKS: [], ready: false,
  exo: 1.0, altOffset: 0, cur: 0, playing: false, speed: 8, solo: null,
  mode: 'over', source: 'ogn', subject: null, focus: null, fpvPitch: 6, fpvFollow: true, bank: true, freeCam: { bearing: 0, pitch: 6 },
  chase: { az: 0, el: 17, dist: 25 },
  trace: 'window', trailFx: 'basic', modelScale: { ...MODEL_SCALE }, windowMin: 10, spline: true, compensated: true, sound: true, trafficMode: 'directional', graphMode: 'off',
  glideCone: false, glideRatio: 10, safetyHeight: 0, coneRadiusKm: 25,
  labels: false, labelFields: { reg: true, alt: true, speed: false, vario: false, hdg: false },
  shadowMode: 'off', altCurtain: false, showAttribution: true,
  live: false, liveTimer: null,
  INIT: { ...INIT },
  mapVS: { ...INIT },
  mapTarget: { ...INIT },
  // source tracks (path times = UTC seconds of day). RAW is the merge target for
  // live refreshes; rebuild() turns it into the render-ready TRACKS.
  RAW: [], CURAF: null, CURTZ: 0, date: '',
  COLOR: {}, colorN: 0,
  // current UI language (fr/en/de), auto-detected from the browser
  lang: ((): Lang => { const l = (navigator.language || '').toLowerCase();
    return l.startsWith('fr') ? 'fr' : l.startsWith('de') ? 'de' : 'en'; })(),
  // current terrain TileLayer instance (rebuilt when exaggeration changes)
  terrainInst: null,
};

// Snapshot the built-in defaults BEFORE applying any persisted overrides, so a
// reset can restore them; then merge in the user's saved settings (if any). This
// runs at module load, before the UI reads S, so controls init to stored values.
export const DEFAULT_SETTINGS = pickSettings(S);
applyStored(S);
