// ============ weather enrichment (Open-Meteo — keyless, CORS) ============
// Optional and offline-first: fetch the day's cloudbase (from surface T + RH, via
// the lifting condensation level) and a wind profile at the airfield, to calibrate
// the air-mass reconstruction. Any failure leaves the caller on its track-derived
// estimates. Recent dates use the forecast endpoint (ERA5 archive lags ~5 days),
// older ones the archive endpoint.
import { S } from './state';

interface Prof { alt: number; u: number; v: number }   // AMSL height + wind vector (m/s, east/north)
interface WxHour { cloudbase: number | null; prof: Prof[] }
export interface Wx { hours: WxHour[] }

const LEVELS = [925, 850, 700];   // hPa: through the convective layer

// Met wind (direction it blows FROM, °) → velocity vector it blows TO (east, north).
const toUV = (sp: number, dir: number): Prof => {
  const r = dir * Math.PI / 180;
  return { alt: 0, u: -sp * Math.sin(r), v: -sp * Math.cos(r) };
};
// Dew point from T (°C) and relative humidity (%) — Magnus formula.
function dewpoint(T: number, RH: number): number {
  const a = 17.625, b = 243.04, g = Math.log(Math.max(1, Math.min(100, RH)) / 100) + a * T / (b + T);
  return b * g / (a - g);
}
// Cloudbase AMSL from the LCL: ~125 m per °C of spread above the field.
function lclBase(T: number, RH: number, elev: number): number | null {
  if (!Number.isFinite(T) || !Number.isFinite(RH)) return null;
  return elev + Math.max(50, 125 * (T - dewpoint(T, RH)));
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
const daysAgo = (date: string): number => (Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(date)) / 86400000;

async function fetchWx(lat: number, lon: number, date: string): Promise<Wx | null> {
  const recent = daysAgo(date) <= 5;   // ERA5 archive lags; use the forecast API for recent days
  const host = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const surf = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m';
  const lvl = LEVELS.flatMap(p => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`]).join(',');
  const url = `${host}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${date}&end_date=${date}`
    + `&hourly=${surf},${lvl}&wind_speed_unit=ms&timezone=UTC`;
  const j = await fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null) as any;
  const h = j && j.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) return null;
  const elev = num(j.elevation);
  const ref = Number.isFinite(elev) ? elev : (S.AF ? S.AF.elev : 0);
  const hours: WxHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const prof: Prof[] = [];
    const s10 = num(h.wind_speed_10m?.[i]), d10 = num(h.wind_direction_10m?.[i]);
    if (Number.isFinite(s10) && Number.isFinite(d10)) prof.push({ ...toUV(s10, d10), alt: ref + 10 });
    for (const p of LEVELS) {
      const hh = num(h[`geopotential_height_${p}hPa`]?.[i]);
      const sp = num(h[`wind_speed_${p}hPa`]?.[i]), dr = num(h[`wind_direction_${p}hPa`]?.[i]);
      if (Number.isFinite(hh) && Number.isFinite(sp) && Number.isFinite(dr)) prof.push({ ...toUV(sp, dr), alt: hh });
    }
    prof.sort((a, b) => a.alt - b.alt);
    hours.push({ cloudbase: lclBase(num(h.temperature_2m?.[i]), num(h.relative_humidity_2m?.[i]), ref), prof });
  }
  return { hours };
}

// ---- lazy, multi-location cache (LRU-capped) ----
const cache = new Map<string, Wx | null>();   // location key → data (null = failed, don't refetch)
const inflight = new Set<string>();
const MAX = 8;                                 // a handful of locations (airfield + view centres)
/** The day's weather at a location, or null while loading / on failure. Kicks off one
 *  background fetch per (location, date); later frames pick up the result. Several
 *  locations coexist (e.g. the airfield and the current view centre). */
export function getWeather(lat: number, lon: number, date: string): Wx | null {
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

const clampHour = (wx: Wx, hour: number): number => Math.max(0, Math.min(wx.hours.length - 1, hour | 0));

/** Cloudbase AMSL (m) at a UTC hour, or null if unavailable. */
export function weatherCloudbase(wx: Wx, hour: number): number | null {
  return wx.hours[clampHour(wx, hour)]?.cloudbase ?? null;
}
/** Wind vector [east, north] (m/s) at an AMSL altitude and UTC hour, or null. */
export function weatherWind(wx: Wx, hour: number, alt: number): [number, number] | null {
  const p = wx.hours[clampHour(wx, hour)]?.prof;
  if (!p || !p.length) return null;
  if (alt <= p[0].alt) return [p[0].u, p[0].v];
  for (let i = 1; i < p.length; i++) {
    if (alt <= p[i].alt) { const a = p[i - 1], b = p[i], f = (alt - a.alt) / Math.max(1, b.alt - a.alt); return [a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f]; }
  }
  const e = p[p.length - 1]; return [e.u, e.v];
}
