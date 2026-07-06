// ============ worldwide wave scan: rank sites by lee-wave potential ============
// "Look at the weather first, then find a field": for a date, batch Open-Meteo over the
// spots and score each for mountain-wave potential from the cross-ridge wind aloft and
// the static stability (Brunt–Väisälä N), keeping only a plausible wavelength
// λ = 2π·U/N. A rough forecast filter, not a guarantee — see the lift-model docs.

export interface WaveScore { code: string; score: number; wind: number; lambda: number }   // score 0..1, wind m/s (850–700 hPa mean), λ metres

const DRY = 0.0098;                 // dry-adiabatic lapse rate (K/m)
const U_MIN = 8, U_FULL = 20;       // m/s: cross-ridge wind for a start / a full score
const N_MIN = 0.006, N_FULL = 0.014;// 1/s: stability for a start / a full score
const LAMBDA_MIN = 2500, LAMBDA_MAX = 22000;   // m: plausible lee-wave wavelengths
const CHUNK = 50;                   // locations per Open-Meteo request

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

/** Score each spot (by code) for wave potential on `date`. Best hour of the day wins.
 *  Spots below a small threshold are omitted. Network/parse failures are skipped. */
export async function scanWaveSites(spots: { code: string; lat: number; lon: number }[], date: string): Promise<Map<string, WaveScore>> {
  const out = new Map<string, WaveScore>();
  const valid = spots.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  const vars = 'wind_speed_850hPa,wind_speed_700hPa,temperature_850hPa,temperature_700hPa,geopotential_height_850hPa,geopotential_height_700hPa';
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const lats = chunk.map(s => s.lat.toFixed(3)).join(','), lons = chunk.map(s => s.lon.toFixed(3)).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${vars}`
      + `&wind_speed_unit=ms&timezone=UTC&start_date=${date}&end_date=${date}`;
    const j = await fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null) as any;
    if (!j) continue;
    const arr = Array.isArray(j) ? j : [j];   // multi-location → array; single → object
    chunk.forEach((s, idx) => {
      const h = arr[idx]?.hourly; if (!h || !Array.isArray(h.time)) return;
      let best = 0, bU = 0, bL = 0;
      for (let t = 0; t < h.time.length; t++) {
        const ws8 = num(h.wind_speed_850hPa?.[t]), ws7 = num(h.wind_speed_700hPa?.[t]);
        const T8 = num(h.temperature_850hPa?.[t]), T7 = num(h.temperature_700hPa?.[t]);
        const z8 = num(h.geopotential_height_850hPa?.[t]), z7 = num(h.geopotential_height_700hPa?.[t]);
        if ([ws8, ws7, T8, T7, z8, z7].some(Number.isNaN)) continue;
        const U = (ws8 + ws7) / 2; if (U < U_MIN) continue;
        const dz = z7 - z8; if (dz < 100) continue;
        const dTheta = (T7 - T8) / dz + DRY; if (dTheta <= 0) continue;   // neutral / unstable
        const N = Math.sqrt(9.81 / ((T8 + T7) / 2 + 273.15) * dTheta);
        if (N < N_MIN) continue;
        const lambda = 2 * Math.PI * U / N; if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) continue;
        const sc = Math.min(1, (U - U_MIN) / (U_FULL - U_MIN)) * Math.min(1, (N - N_MIN) / (N_FULL - N_MIN));
        if (sc > best) { best = sc; bU = U; bL = lambda; }
      }
      if (best > 0.05) out.set(s.code, { code: s.code, score: best, wind: bU, lambda: bL });
    });
  }
  return out;
}
