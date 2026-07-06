// ============ worldwide wave scan: rank sites by lee-wave potential ============
// "Look at the weather first, then find a field": for a date, score each spot for
// mountain-wave potential from FOUR ingredients —
//   1. cross-ridge wind aloft (850–700 hPa),
//   2. static stability (Brunt–Väisälä N),
//   3. a plausible wavelength λ = 2π·U/N,
//   4. actual RELIEF around the site + the wind crossing the ridge (not blowing along it).
// Wind/stability come from a batched Open-Meteo forecast; relief is sampled from the
// Terrarium DEM tiles (dem.ts — same tiles as the terrain, no API limit) and persisted
// (the DEM is static). A rough forecast filter, not a guarantee — see the docs.
import { demElev } from './dem';

export interface WaveScore { code: string; score: number; wind: number; lambda: number; relief: number }

const DRY = 0.0098;                 // dry-adiabatic lapse rate (K/m)
const U_MIN = 8, U_FULL = 20;       // m/s: cross-ridge wind for a start / a full score
const N_MIN = 0.006, N_FULL = 0.014;// 1/s: stability for a start / a full score
const LAMBDA_MIN = 2500, LAMBDA_MAX = 22000;   // m: plausible lee-wave wavelengths
const RELIEF_MIN = 250, RELIEF_FULL = 1100;    // m: relief for a start / a full score
export const WAVE_SITE_RELIEF = 500;           // m: wide relief (≤24 km) → "wave terrain"
const HILL_MIN = 130;                          // m: local relief (≤9 km) → "ridge", else "plain"
const RING = 8, RINGS_KM = [9, 18, 28];        // elevation rings (km): inner = local, outer = far ridges
const CHUNK = 50;                   // spots per weather request
const RELIEF_KEY = 'ogn.relief.v1'; // persisted relief cache (DEM is static)

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ---- relief (static, cached across dates) ----
// We keep several concentric elevation rings (not a single dominant gradient — a site can
// have several ridges in different orientations, whose vector gradients cancel, and the
// triggering ridge may be tens of km upwind). Alignment is judged per wind direction from
// the relief seen ALONG the wind across all rings (a ridge to cross, at any distance).
type Ring = { ang: number; e: number }[];
interface Relief { relief: number; local: number; c: number; rings: Ring[] }   // relief = wide (≤28 km), local = ≤9 km
const reliefCache = new Map<string, Relief>();

// The relief is static → persist it (localStorage), so tags appear instantly after the
// first-ever computation and no DEM tiles are re-sampled on later visits.
try {
  const raw = localStorage.getItem(RELIEF_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Relief>)) reliefCache.set(k, v);
} catch { /* ignore */ }
function saveRelief(): void {
  try { localStorage.setItem(RELIEF_KEY, JSON.stringify(Object.fromEntries(reliefCache))); } catch { /* quota / private */ }
}

// Ring elevation interpolated at an azimuth (ring is evenly spaced, sorted by angle).
function ringElevAt(ring: Ring, az: number): number {
  const n = ring.length, step = 2 * Math.PI / n;
  const a = ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), i = Math.floor(a / step), f = (a - i * step) / step;
  const A = ring[i % n].e, B = ring[(i + 1) % n].e;
  return A + (B - A) * f;
}
// Relief seen along the wind axis (both ways, every ring) vs the centre — the biggest
// ridge the wind crosses, at whatever distance/orientation.
function alongWindRelief(rel: Relief, wdRad: number): number {
  let mn = rel.c, mx = rel.c;
  for (const ring of rel.rings) {
    for (const e of [ringElevAt(ring, wdRad), ringElevAt(ring, wdRad + Math.PI)]) { mn = Math.min(mn, e); mx = Math.max(mx, e); }
  }
  return mx - mn;
}

/** The site's local relief (m), or NaN until {@link ensureRelief} has run for it. */
export function siteRelief(code: string): number {
  return reliefCache.get(code)?.relief ?? NaN;
}
/** True once the site's relief is known and high enough to make it "wave terrain". */
export function isWaveSite(code: string): boolean {
  const r = reliefCache.get(code); return !!r && r.relief >= WAVE_SITE_RELIEF;
}
/** Terrain class: mountain/wave if big relief is within reach (≤28 km), else ridge if
 *  there is local relief (≤9 km), else plain. '' until {@link ensureRelief} has run. */
export function siteTerrain(code: string): '' | 'flat' | 'hill' | 'wave' {
  const r = reliefCache.get(code);
  if (!r) return '';
  return r.relief >= WAVE_SITE_RELIEF ? 'wave' : r.local >= HILL_MIN ? 'hill' : 'flat';
}

/** Compute + cache the relief of any spots not yet known, sampling the DEM tiles.
 *  Persists as it goes; `onProgress` fires after each batch so tags fill in live. */
export async function ensureRelief(spots: { code: string; lat: number; lon: number }[], onProgress?: () => void): Promise<void> {
  const need = spots.filter(s => !reliefCache.has(s.code) && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!need.length) return;
  let done = 0, changed = false;
  for (const s of need) {
    const mLon = 111.32 * Math.cos(s.lat * Math.PI / 180);
    // sample the centre + every ring point (nearby points share cached DEM tiles)
    const jobs: Promise<number | null>[] = [demElev(s.lon, s.lat)];
    for (const R of RINGS_KM) for (let a = 0; a < RING; a++) {
      const th = a / RING * 2 * Math.PI;
      jobs.push(demElev(s.lon + R / mLon * Math.sin(th), s.lat + R / 111.32 * Math.cos(th)));
    }
    const es = await Promise.all(jobs);
    const c = es[0];
    if (c != null) {
      const rings: Ring[] = RINGS_KM.map((_, ri) => Array.from({ length: RING }, (_, a) => ({ ang: a / RING * 2 * Math.PI, e: es[1 + ri * RING + a] })).filter(p => p.e != null) as Ring);
      if (!rings.some(r => r.length < RING)) {
        let mn = c, mx = c, lmn = c, lmx = c;                    // wide (all rings) + local (inner ring only)
        rings.forEach((ring, ri) => { for (const { e } of ring) { mn = Math.min(mn, e); mx = Math.max(mx, e); if (ri === 0) { lmn = Math.min(lmn, e); lmx = Math.max(lmx, e); } } });
        reliefCache.set(s.code, { relief: mx - mn, local: lmx - lmn, c, rings });
        changed = true;
      }
    }
    if (++done % 8 === 0 && changed) { saveRelief(); onProgress?.(); changed = false; }
  }
  if (changed) saveRelief();
  onProgress?.();
}

/** Score each spot (by code) for wave potential on `date`. Best hour of the day wins.
 *  Spots below a small threshold are omitted. Network/parse failures are skipped. */
export async function scanWaveSites(spots: { code: string; lat: number; lon: number }[], date: string): Promise<Map<string, WaveScore>> {
  await ensureRelief(spots).catch(() => { /* keep going without relief */ });
  const out = new Map<string, WaveScore>();
  const valid = spots.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  const vars = 'wind_speed_850hPa,wind_direction_850hPa,wind_speed_700hPa,temperature_850hPa,temperature_700hPa,geopotential_height_850hPa,geopotential_height_700hPa';
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const lats = chunk.map(s => s.lat.toFixed(3)).join(','), lons = chunk.map(s => s.lon.toFixed(3)).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${vars}`
      + `&wind_speed_unit=ms&timezone=UTC&start_date=${date}&end_date=${date}`;
    const j = await fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null) as any;
    if (!j) continue;
    const arr = Array.isArray(j) ? j : [j];
    chunk.forEach((s, idx) => {
      const h = arr[idx]?.hourly; if (!h || !Array.isArray(h.time)) return;
      const rel = reliefCache.get(s.code);
      const reliefF = rel ? clamp01((rel.relief - RELIEF_MIN) / (RELIEF_FULL - RELIEF_MIN)) : 0.5;   // unknown → neutral
      if (reliefF <= 0) return;                                  // flat site → no wave
      let best = 0, bU = 0, bL = 0;
      for (let t = 0; t < h.time.length; t++) {
        const ws8 = num(h.wind_speed_850hPa?.[t]), ws7 = num(h.wind_speed_700hPa?.[t]), wd = num(h.wind_direction_850hPa?.[t]);
        const T8 = num(h.temperature_850hPa?.[t]), T7 = num(h.temperature_700hPa?.[t]);
        const z8 = num(h.geopotential_height_850hPa?.[t]), z7 = num(h.geopotential_height_700hPa?.[t]);
        if ([ws8, ws7, wd, T8, T7, z8, z7].some(Number.isNaN)) continue;
        const U = (ws8 + ws7) / 2; if (U < U_MIN) continue;
        const dz = z7 - z8; if (dz < 100) continue;
        const dTheta = (T7 - T8) / dz + DRY; if (dTheta <= 0) continue;
        const N = Math.sqrt(9.81 / ((T8 + T7) / 2 + 273.15) * dTheta); if (N < N_MIN) continue;
        const lambda = 2 * Math.PI * U / N; if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) continue;
        // wind must CROSS a ridge: score the relief seen along the wind (handles several
        // ridges — whatever the orientation, we only ask that the wind meets some of it).
        const align = rel ? 0.4 + 0.6 * clamp01(alongWindRelief(rel, wd * Math.PI / 180) / Math.max(150, 0.55 * rel.relief)) : 0.6;
        const sc = clamp01((U - U_MIN) / (U_FULL - U_MIN)) * clamp01((N - N_MIN) / (N_FULL - N_MIN)) * align;
        if (sc > best) { best = sc; bU = U; bL = lambda; }
      }
      const score = best * reliefF;
      if (score > 0.05) out.set(s.code, { code: s.code, score, wind: bU, lambda: bL, relief: rel ? rel.relief : 0 });
    });
  }
  return out;
}
