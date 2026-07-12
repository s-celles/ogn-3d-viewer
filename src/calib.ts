// ============ calibration of the predicted Vz against the observed climbs =========
// The physics field (thermal.ts) has an absolute scale that is only a guess. But the
// day's tracks give us REAL climb rates (airmass.ts detects circling-climbs with their
// strength). So we predict Vz at each detected thermal's place and time with the same
// physics, take the robust ratio observed/predicted, and use it to rescale the field —
// grounding the prediction in the day's measurements. A single global factor (not a
// spatial assimilation): it adjusts how strong the day reads, not the pattern.
import { S } from './state';
import { getThermals } from './airmass';
import { terrainElevAt } from './terrain';
import { sunLightDir } from './core/sky';
import { getWeather, weatherRad, weatherConvTop } from './weather';
import { M_PER_LAT, mPerLng } from './core/geo';

const G = 9.81, THETA = 290, RHOCP = 1200;   // gravity, ref pot. temp (K), ρ·cp (J/m³K)
const ALBEDO = 0.2, BETA = 0.35, GRAD = 80;  // uniform surface (calibration is a magnitude match)

// Predicted updraught Vz (m/s) at a point and instant, with the thermal.ts physics but
// uniform land-cover and no cast shadows (a point estimate for the ratio). Null when
// the terrain/sun is unavailable or the sun is down / above the boundary layer.
function predictVz(lon: number, lat: number, ms: number, hour: number): number | null {
  const h = terrainElevAt(lon, lat); if (h == null) return null;
  const mLng = mPerLng(lat), mLat = M_PER_LAT;
  const hE = terrainElevAt(lon + GRAD / mLng, lat), hW = terrainElevAt(lon - GRAD / mLng, lat);
  const hN = terrainElevAt(lon, lat + GRAD / mLat), hS = terrainElevAt(lon, lat - GRAD / mLat);
  if (hE == null || hW == null || hN == null || hS == null) return null;
  const gx = (hE - hW) / (2 * GRAD), gy = (hN - hS) / (2 * GRAD);
  const ld = sunLightDir(ms, lat, lon), su: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
  if (su[2] <= 0.02) return null;
  const wx = S.source !== 'file' ? getWeather(Math.round(lat / 0.1) * 0.1, Math.round(lon / 0.1) * 0.1, S.date) : null;
  const rad = wx ? weatherRad(wx, hour) : { sw: NaN, diff: NaN, blh: NaN };
  const diff = Number.isFinite(rad.diff) ? rad.diff : 90;
  const dni = Math.min(1050, Math.max(0, ((Number.isFinite(rad.sw) ? rad.sw : 1000 * su[2]) - diff)) / su[2]);
  const topA = wx ? weatherConvTop(wx, hour) : NaN;
  const zi = Math.max(0, Math.min(3500, Number.isFinite(topA) ? topA - h : (Number.isFinite(rad.blh) && rad.blh > 200 ? rad.blh : 1500)));
  if (zi < 100) return null;
  const nl = Math.hypot(gx, gy, 1), cosInc = Math.max(0, (su[0] * -gx + su[1] * -gy + su[2]) / nl);
  const H = (dni * cosInc + diff) * (1 - ALBEDO) * BETA;
  return 0.6 * Math.cbrt((G / THETA) * (H / RHOCP) * zi);
}

let cache: { tracks: unknown; date: string; wxr: boolean; cal: number } | null = null;

/** Day-scale calibration factor for the predicted Vz field: the median of
 *  (observed climb / predicted Vz) over the detected thermals, clamped to a sane
 *  range. 1 when there aren't enough thermals, or for imported files. Memoised on the
 *  track set, date and weather-readiness. */
export function liftCalibration(): number {
  if (!S.liftCalibrate || S.source === 'file' || !S.date) return 1;   // opt-in
  const wxr = !!(S.AF && getWeather(S.AF.lat, S.AF.lon, S.date));
  if (cache && cache.tracks === S.TRACKS && cache.date === S.date && cache.wxr === wxr) return cache.cal;
  const ths = getThermals();
  const dayMs = Date.parse(S.date + 'T00:00:00Z');
  const ratios: number[] = [];
  for (const th of ths) {
    const lon = (th.c0[0] + th.c1[0]) / 2, lat = (th.c0[1] + th.c1[1]) / 2, tmid = (th.t0 + th.t1) / 2;
    const pred = predictVz(lon, lat, dayMs + (S.G0 + tmid) * 1000, Math.floor((S.G0 + tmid) / 3600));
    if (pred != null && pred > 0.25) ratios.push(th.strength / pred);
  }
  let cal = 1;
  if (ratios.length >= 4) {
    ratios.sort((a, b) => a - b);
    cal = Math.max(0.4, Math.min(3.5, ratios[Math.floor(ratios.length / 2)]));   // robust median, clamped
  }
  cache = { tracks: S.TRACKS, date: S.date, wxr, cal };
  return cal;
}
