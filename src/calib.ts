// ============ calibration of the predicted Vz against the observed climbs =========
// The maths lives in core/lift/calib.ts: predict Vz where each observed thermal was, take the
// robust median of observed/predicted, rescale the field by it. This file is the glue — it
// reads the app's tracks, date and weather, and memoises the result.
import { S } from './state';
import { getThermals } from './airmass';
import { terrainElevAt } from './terrain';
import { sunLightDir } from 'soaring-core/sky';
import { getWeather, weatherRad, weatherConvTop } from './weather';
import { predictVzAt, calibrationFactor, type Radiation } from 'soaring-core/lift/calib';

/** The radiation the point prediction needs, at an hour of the loaded day. */
function radiationAt(lon: number, lat: number, hour: number, sunUp: number): Radiation {
  const wx = S.source !== 'file' ? getWeather(Math.round(lat / 0.1) * 0.1, Math.round(lon / 0.1) * 0.1, S.date) : null;
  const r = wx ? weatherRad(wx, hour) : { sw: NaN, diff: NaN, blh: NaN };
  const diff = Number.isFinite(r.diff) ? r.diff : 90;
  return {
    diff,
    dni: Math.min(1050, Math.max(0, ((Number.isFinite(r.sw) ? r.sw : 1000 * sunUp) - diff)) / sunUp),
    convTop: wx ? weatherConvTop(wx, hour) : NaN,
    ziFallback: Number.isFinite(r.blh) && r.blh > 200 ? r.blh : 1500,
  };
}

let cache: { tracks: unknown; date: string; wxr: boolean; cal: number } | null = null;

/** Day-scale calibration factor for the predicted Vz field. 1 when there aren't enough
 *  thermals, or for imported files. Memoised on the track set, date and weather-readiness. */
export function liftCalibration(): number {
  if (!S.liftCalibrate || S.source === 'file' || !S.date) return 1;   // opt-in
  const wxr = !!(S.AF && getWeather(S.AF.lat, S.AF.lon, S.date));
  if (cache && cache.tracks === S.TRACKS && cache.date === S.date && cache.wxr === wxr) return cache.cal;
  const dayMs = Date.parse(S.date + 'T00:00:00Z');
  const pairs = getThermals().map(th => {
    const lon = (th.c0[0] + th.c1[0]) / 2, lat = (th.c0[1] + th.c1[1]) / 2, tmid = (th.t0 + th.t1) / 2;
    const ms = dayMs + (S.G0 + tmid) * 1000, hour = Math.floor((S.G0 + tmid) / 3600);
    const ld = sunLightDir(ms, lat, lon);
    const sun: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
    const predicted = sun[2] > 0.02
      ? predictVzAt(lon, lat, terrainElevAt, sun, radiationAt(lon, lat, hour, sun[2]))
      : null;
    return { observed: th.strength, predicted };
  });
  const cal = calibrationFactor(pairs);
  cache = { tracks: S.TRACKS, date: S.date, wxr, cal };
  return cal;
}
