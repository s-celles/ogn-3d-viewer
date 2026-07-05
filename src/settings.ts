// ============ user-settings persistence (localStorage) ============
// Persist the user's display/replay preferences across sessions, and allow a
// one-click reset to defaults. Only genuine *settings* are stored — never the
// loaded flight data, the replay clock, the camera navigation, the current view
// mode or the live/source session (those are per-visit or data-driven).
import type { AppState } from './types';

const STORAGE_KEY = 'ogn3d.settings.v1';

// The AppState fields that are user preferences. Object-valued ones (modelScale,
// labelFields) are merged over the current defaults on load, so a sub-key added
// in a later version still picks up its default rather than being dropped.
export const SETTING_KEYS = [
  'exo', 'groundZoom', 'cacheScale', 'dev', 'speed', 'fpvPitch', 'bank',
  'trace', 'trailFx', 'modelScale', 'windowMin', 'spline', 'compensated', 'sound',
  'trafficMode', 'graphMode',
  'glideCone', 'glideRatio', 'safetyHeight', 'coneRadiusKm',
  'labels', 'labelFields', 'shadowMode', 'altCurtain', 'showAttribution', 'basemap', 'ignDem', 'showPeaks', 'peakDensity', 'minimap', 'overviewHud', 'activeOnly', 'airMass', 'thermalPot', 'liftThermal', 'liftSlope', 'windMode', 'heightRef', 'clockUTC', 'clock12', 'lang', 'langAuto',
] as const;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A deep-cloned snapshot of just the settings fields (JSON-safe values). */
export function pickSettings(s: AppState): Partial<AppState> {
  const o: any = {};
  for (const k of SETTING_KEYS) o[k] = clone((s as any)[k]);
  return o;
}

/** Merge persisted settings (if any) into the live state. Best-effort: a corrupt
 *  or partial store is ignored, and each value must match the default's type. */
export function applyStored(s: AppState): void {
  let stored: any;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { stored = null; }
  if (!isObj(stored)) return;
  for (const k of SETTING_KEYS) {
    if (!(k in stored)) continue;
    const cur = (s as any)[k], val = stored[k];
    if (isObj(cur) && isObj(val)) (s as any)[k] = { ...cur, ...val };  // merge object settings
    else if (typeof cur === typeof val) (s as any)[k] = val;           // primitive of matching type
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastJSON = '';
/** Debounced, dirty-checked persist. Safe to call very often (e.g. once per
 *  animation frame): it coalesces to one localStorage write per change. */
export function saveSettings(s: AppState): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const json = JSON.stringify(pickSettings(s));
    if (json === lastJSON) return;
    lastJSON = json;
    try { localStorage.setItem(STORAGE_KEY, json); } catch { /* private mode / quota — ignore */ }
  }, 600);
}

/** Forget the persisted settings (used by reset-to-defaults). */
export function clearStored(): void {
  lastJSON = '';
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
