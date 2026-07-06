// ============ worldwide wave scan: rank sites by lee-wave potential ============
// "Look at the weather first, then find a field": for a date, score each spot for
// mountain-wave potential from FOUR ingredients —
//   1. cross-ridge wind aloft (850–700 hPa),
//   2. static stability (Brunt–Väisälä N),
//   3. a plausible wavelength λ = 2π·U/N,
//   4. actual RELIEF around the site + the wind crossing the ridge (not blowing along it).
// Wind/stability come from a batched Open-Meteo forecast; relief from a batched Open-Meteo
// elevation ring (cached — the terrain doesn't change). A rough forecast filter, not a
// guarantee — see the lift-model docs.

export interface WaveScore { code: string; score: number; wind: number; lambda: number; relief: number }

const DRY = 0.0098;                 // dry-adiabatic lapse rate (K/m)
const U_MIN = 8, U_FULL = 20;       // m/s: cross-ridge wind for a start / a full score
const N_MIN = 0.006, N_FULL = 0.014;// 1/s: stability for a start / a full score
const LAMBDA_MIN = 2500, LAMBDA_MAX = 22000;   // m: plausible lee-wave wavelengths
const RELIEF_MIN = 250, RELIEF_FULL = 1100;    // m: local relief for a start / a full score
const RING = 8, RINGS_KM = [9, 18, 28];        // elevation: several rings (km) to catch ridges at any distance
const CHUNK = 50;                   // spots per weather request

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ---- relief (static, cached across dates) ----
// We keep several concentric elevation rings (not a single dominant gradient — a site can
// have several ridges in different orientations, whose vector gradients cancel, and the
// triggering ridge may be tens of km upwind). Alignment is judged per wind direction from
// the relief seen ALONG the wind across all rings (a ridge to cross, at any distance).
type Ring = { ang: number; e: number }[];
interface Relief { relief: number; c: number; rings: Ring[] }
const reliefCache = new Map<string, Relief>();

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

async function ensureRelief(spots: { code: string; lat: number; lon: number }[]): Promise<void> {
  const need = spots.filter(s => !reliefCache.has(s.code) && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!need.length) return;
  interface P { code: string; lat: number; lon: number; ri: number; ang: number }   // ri < 0 → the centre
  const pts: P[] = [];
  for (const s of need) {
    pts.push({ code: s.code, lat: s.lat, lon: s.lon, ri: -1, ang: 0 });
    const mLon = 111.32 * Math.cos(s.lat * Math.PI / 180);
    RINGS_KM.forEach((R, ri) => {
      for (let a = 0; a < RING; a++) {
        const th = a / RING * 2 * Math.PI;
        pts.push({ code: s.code, lat: s.lat + R / 111.32 * Math.cos(th), lon: s.lon + R / mLon * Math.sin(th), ri, ang: th });
      }
    });
  }
  const acc = new Map<string, { c: number; rings: Ring[] }>();
  // fetch all elevation chunks in parallel (one-time; then cached)
  const chunks: P[][] = [];
  for (let i = 0; i < pts.length; i += 100) chunks.push(pts.slice(i, i + 100));
  const results = await Promise.all(chunks.map(ch => {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${ch.map(p => p.lat.toFixed(4)).join(',')}&longitude=${ch.map(p => p.lon.toFixed(4)).join(',')}`;
    return fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null) as Promise<any>;
  }));
  chunks.forEach((ch, ci) => {
    const el = results[ci] && Array.isArray(results[ci].elevation) ? results[ci].elevation : null; if (!el) return;
    ch.forEach((p, idx) => {
      const e = num(el[idx]); if (Number.isNaN(e)) return;
      let rec = acc.get(p.code); if (!rec) { rec = { c: NaN, rings: RINGS_KM.map(() => []) }; acc.set(p.code, rec); }
      if (p.ri < 0) rec.c = e; else rec.rings[p.ri].push({ ang: p.ang, e });
    });
  });
  for (const [code, rec] of acc) {
    if (Number.isNaN(rec.c) || rec.rings.some(r => r.length < RING)) continue;
    rec.rings.forEach(r => r.sort((a, b) => a.ang - b.ang));
    let mn = rec.c, mx = rec.c;
    for (const ring of rec.rings) for (const { e } of ring) { mn = Math.min(mn, e); mx = Math.max(mx, e); }
    reliefCache.set(code, { relief: mx - mn, c: rec.c, rings: rec.rings });
  }
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
