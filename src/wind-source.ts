// ============ where the wind comes from ============
// The kernel's lift fields take the wind as a plain vector; this is the app-side
// adapter that produces it — the weather forecast at the view centre when we have one,
// the airfield's profile otherwise, and as a last resort the mean drift of the observed
// thermals. It reads app state and the weather cache, so it stays out of src/core.
import { S } from './state';
import { terrainElevAt } from './terrain';
import { getWeather, weatherWind } from './weather';
import { getThermals } from './airmass';
import type { WindProfile } from './core/ports';
import { M_PER_LAT, mPerLng } from './core/geo';

// Mean thermal drift (m/s) — the last-resort wind when there is no weather.
function driftWind(): [number, number] | null {
  const ths = getThermals();
  if (!ths.length) return null;
  let u = 0, v = 0;
  for (const th of ths) {
    const dur = Math.max(1, th.t1 - th.t0), lat = (th.c0[1] + th.c1[1]) / 2, mLng = mPerLng(lat);
    u += (th.c1[0] - th.c0[0]) / dur * mLng; v += (th.c1[1] - th.c0[1]) / dur * M_PER_LAT;
  }
  return [u / ths.length, v / ths.length];
}

/** Wind [east, north] (m/s) at an AMSL altitude: the weather profile at the view
 *  centre (bucketed ~10 km), else at the airfield, else the mean thermal drift. */
export function windAtAlt(cLat: number, cLon: number, alt: number): [number, number] | null {
  if (S.wxSim.on || (S.source !== 'file' && S.date)) {
    const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
    const pick = (la: number, lo: number): [number, number] | null => {
      const wx = getWeather(la, lo, S.date); return wx ? weatherWind(wx, hour, alt) : null;
    };
    const w = pick(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1) || (S.AF ? pick(S.AF.lat, S.AF.lon) : null);
    if (w) return w;
  }
  return driftWind();
}

/** The wind as a vertical PROFILE at a place: what the lift fields want, so each cell can be
 *  given the wind at its own height instead of the whole scene sharing the camera's. */
export const windProfile = (cLat: number, cLon: number): WindProfile =>
  (alt: number) => windAtAlt(cLat, cLon, alt);

/** Background low-level wind: the profile ~mid-ridge above the local surface. */
export function windBg(cLat: number, cLon: number): [number, number] | null {
  return windAtAlt(cLat, cLon, (terrainElevAt(cLon, cLat) ?? (S.AF ? S.AF.elev : 0)) + 400);
}
