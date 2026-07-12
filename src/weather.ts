// ============ weather provisioning (Open-Meteo — keyless, CORS) ============
// The app half of the weather: WHERE the day's atmosphere comes from — the network,
// a lazy per-location cache, or the sandbox knobs in S. The atmosphere ITSELF (wind
// profile, sounding, cloudbase, ceiling, stability) is domain code and lives in
// core/weather.ts, which knows nothing of fetch or of S — so an offline flight
// computer can feed it from a pre-flight data pack instead.
// Any failure here simply leaves the caller on its track-derived estimates.
// Recent dates use the forecast endpoint (ERA5 archive lags ~5 days), older ones the
// archive endpoint.
import { S } from './state';
import { LEVELS, parseOpenMeteo, syntheticWx, type Wx } from './core/weather';

// Re-exported so app modules keep one import site for the weather.
export {
  weatherCloudbase, weatherRad, weatherConvTop, weatherSounding, weatherStability, weatherWind,
  envT, parcelT, daySummary, type Wx, type Sounding,
} from './core/weather';

const daysAgo = (date: string): number => (Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(date)) / 86400000;

async function fetchWx(lat: number, lon: number, date: string): Promise<Wx | null> {
  const recent = daysAgo(date) <= 5;   // ERA5 archive lags; use the forecast API for recent days
  const host = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const surf = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,shortwave_radiation,diffuse_radiation,boundary_layer_height';
  const lvl = LEVELS.flatMap(p => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`, `temperature_${p}hPa`]).join(',');
  const url = `${host}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${date}&end_date=${date}`
    + `&hourly=${surf},${lvl}&wind_speed_unit=ms&timezone=UTC`;
  const j = await fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
  return parseOpenMeteo(j, S.AF ? S.AF.elev : 0);
}

// ---- lazy, multi-location cache (LRU-capped) ----
const cache = new Map<string, Wx | null>();   // location key → data (null = failed, don't refetch)
const inflight = new Set<string>();
const MAX = 8;                                 // a handful of locations (airfield + view centres)
/** The day's weather at a location, or null while loading / on failure. Kicks off one
 *  background fetch per (location, date); later frames pick up the result. Several
 *  locations coexist (e.g. the airfield and the current view centre). */
export function getWeather(lat: number, lon: number, date: string): Wx | null {
  if (S.wxSim?.on) return simWx();   // sandbox: a synthetic atmosphere, ignoring location/date
  const k = `${lat.toFixed(2)}|${lon.toFixed(2)}|${date}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  if (!inflight.has(k)) {
    inflight.add(k);
    fetchWx(lat, lon, date)
      .then(r => { cache.set(k, r); while (cache.size > MAX) cache.delete(cache.keys().next().value as string); })
      .catch(() => cache.set(k, null))
      .finally(() => inflight.delete(k));
  }
  return null;
}

// ---- weather sandbox ----
// The synthetic atmosphere itself is core/weather.ts's syntheticWx; here we only bind
// it to the UI knobs in S and memoise it. The sun still follows the real date, so
// thermals keep their diurnal geometry.
let simKey = '', simCache: Wx | null = null, epoch = 0;
/** Bumps whenever the sandbox atmosphere changes — folded into the model caches so they
 *  refresh even when only the stability changes (the wind cache key wouldn't catch it). */
export function wxEpoch(): number { return epoch; }
function simWx(): Wx {
  const s = S.wxSim, k = JSON.stringify(s);
  if (k === simKey && simCache) return simCache;
  simKey = k; epoch++;
  return (simCache = syntheticWx(s, S.AF ? S.AF.elev : 0));
}
