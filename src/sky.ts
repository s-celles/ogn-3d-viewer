// ============ computed sky colour ============
// The sky colour is derived from the SUN'S ELEVATION at the airfield position,
// on the loaded date and at the current playback time (UTC). High sun → blue,
// low sun → golden/orange, below the horizon → twilight → night. We set two CSS
// variables (zenith + horizon) that drive the #map gradient.
import { S } from './state';

const RAD = Math.PI / 180;

// Sun altitude (degrees above the horizon) for a UTC instant and location.
// Compact SunCalc / NOAA solar-position formula.
export function sunAltitudeDeg(ms: number, lat: number, lon: number): number {
  const d = ms / 86400000 - 0.5 + 2440588 - 2451545;       // days since J2000.0
  const M = RAD * (357.5291 + 0.98560028 * d);              // solar mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); // equation of center
  const L = M + C + RAD * 102.9372 + Math.PI;               // ecliptic longitude
  const e = RAD * 23.4397;                                  // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(L));         // declination
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L)); // right ascension
  const th = RAD * (280.16 + 360.9856235 * d) - RAD * (-lon); // sidereal time
  const H = th - ra;                                        // hour angle
  const phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return alt / RAD;
}

type RGB = [number, number, number];
// Elevation (deg) → [zenith colour, horizon colour]. Interpolated between stops.
const STOPS: [number, RGB, RGB][] = [
  [65, [40, 96, 190], [135, 185, 228]],    // high noon — deep saturated blue
  [35, [62, 124, 210], [158, 198, 232]],   // mid — medium blue
  [15, [104, 158, 216], [188, 210, 231]],  // low sun — paler, hazier
  [7, [144, 174, 206], [226, 206, 182]],   // golden hour approaching, warm horizon
  [2, [150, 146, 178], [244, 172, 112]],   // sunrise / sunset — golden horizon
  [-3, [70, 76, 122], [214, 112, 80]],     // orange horizon, blue-violet top
  [-7, [34, 44, 88], [92, 72, 112]],       // civil dusk
  [-14, [16, 22, 56], [26, 32, 72]],       // nautical twilight
  [-22, [8, 12, 32], [12, 16, 40]],        // astronomical → night
];

const mix = (a: RGB, b: RGB, t: number): RGB =>
  [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

export function skyColors(elev: number): { zenith: RGB; horizon: RGB } {
  if (elev >= STOPS[0][0]) return { zenith: STOPS[0][1], horizon: STOPS[0][2] };
  const last = STOPS[STOPS.length - 1];
  if (elev <= last[0]) return { zenith: last[1], horizon: last[2] };
  for (let i = 0; i < STOPS.length - 1; i++) {
    const hi = STOPS[i], lo = STOPS[i + 1];
    if (elev <= hi[0] && elev >= lo[0]) {
      const t = (elev - lo[0]) / (hi[0] - lo[0]); // 0 at lo, 1 at hi
      return { zenith: mix(lo[1], hi[1], t), horizon: mix(lo[2], hi[2], t) };
    }
  }
  return { zenith: last[1], horizon: last[2] };
}

let lastKey = '';
// Recompute the sky from the current position/date/time and update the CSS
// variables. Throttled to once per simulated minute. Called each render.
export function updateSky(): void {
  if (!S.ready || !S.AF || !S.date) return;
  const utcSod = S.G0 + S.cur;                              // UTC seconds-of-day
  const key = S.date + '|' + Math.round(utcSod / 60);
  if (key === lastKey) return; lastKey = key;
  const ms = Date.parse(S.date + 'T00:00:00Z') + utcSod * 1000;
  if (!Number.isFinite(ms)) return;
  const { zenith, horizon } = skyColors(sunAltitudeDeg(ms, S.AF.lat, S.AF.lon));
  const css = document.documentElement.style;
  css.setProperty('--sky-zenith', `rgb(${zenith.join(',')})`);
  css.setProperty('--sky-horizon', `rgb(${horizon.join(',')})`);
}
