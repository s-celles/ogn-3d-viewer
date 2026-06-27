// ============ computed sky colour ============
// The sky colour is derived from the SUN'S ELEVATION at the airfield position,
// on the loaded date and at the current playback time (UTC). High sun → blue,
// low sun → golden/orange, below the horizon → twilight → night. We set two CSS
// variables (zenith + horizon) that drive the #map gradient.
import { S } from './state';

const RAD = Math.PI / 180;

// Sun altitude + azimuth (radians) for a UTC instant and location. Compact
// SunCalc / NOAA solar-position formula. Azimuth follows SunCalc: measured from
// south, positive toward west.
function solar(ms: number, lat: number, lon: number): { alt: number; az: number } {
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
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt, az };
}

// Sun altitude in degrees above the horizon.
export function sunAltitudeDeg(ms: number, lat: number, lon: number): number {
  return solar(ms, lat, lon).alt / RAD;
}

const E = RAD * 23.4397;                                   // obliquity of the ecliptic

// Days since J2000.0 for a UTC instant (same epoch as solar()).
function days(ms: number): number {
  return ms / 86400000 - 0.5 + 2440588 - 2451545;
}

// Sun geocentric equatorial coords (right ascension, declination), for the moon
// phase computation. Mirrors solar()'s ecliptic-longitude steps with b = 0.
function sunRaDec(d: number): { ra: number; dec: number } {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { ra: Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L)), dec: Math.asin(Math.sin(E) * Math.sin(L)) };
}

// Moon geocentric ecliptic → equatorial coords + distance (km). SunCalc's
// low-precision lunar series — good to ~a few arcminutes, plenty for a sky disc.
function moonRaDec(d: number): { ra: number; dec: number; dist: number } {
  const L = RAD * (218.316 + 13.176396 * d);              // mean longitude
  const M = RAD * (134.963 + 13.064993 * d);              // mean anomaly
  const F = RAD * (93.272 + 13.229350 * d);               // argument of latitude
  const l = L + RAD * 6.289 * Math.sin(M);                // ecliptic longitude
  const b = RAD * 5.128 * Math.sin(F);                    // ecliptic latitude
  const dist = 385001 - 20905 * Math.cos(M);             // distance to Earth, km
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l)),
    dist,
  };
}

// Equatorial coords → local horizon (altitude, azimuth-from-south). Same
// sidereal-time convention as solar().
function horizonCoords(ra: number, dec: number, d: number, lat: number, lon: number): { alt: number; az: number } {
  const th = RAD * (280.16 + 360.9856235 * d) + RAD * lon;
  const H = th - ra, phi = RAD * lat;
  return {
    alt: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
    az: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
  };
}

// Moon illuminated fraction (0..1) and phase (0 new → 0.5 full → 1 new; <0.5 is
// waxing, so the lit limb is on the right in the northern hemisphere).
function moonIllumination(d: number): { fraction: number; phase: number } {
  const s = sunRaDec(d), m = moonRaDec(d), sdist = 149598000;
  const elong = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(elong), m.dist - sdist * Math.cos(elong));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
}

// deck.gl DirectionalLight `direction` (the way light travels: from the sun to
// the scene) in LNGLAT common space (x=east, y=north, z=up). Unit vector.
export function sunLightDir(ms: number, lat: number, lon: number): [number, number, number] {
  const { alt, az } = solar(ms, lat, lon);
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), -Math.sin(alt)];
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

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Sun params: deck LightingEffect inputs + sky-disc info (direction toward the
// sun, whether it's above the horizon, and the disc colour).
export interface SunLight {
  dir: [number, number, number]; intensity: number; color: RGB; ambient: number;
  toward: [number, number, number]; up: boolean; disc: RGB;
}
let sun: SunLight = {
  dir: [-0.6, -1, -0.5], intensity: 2.4, color: [255, 245, 225], ambient: 1.05,
  toward: [0.6, 1, 0.5], up: false, disc: [255, 240, 220],
};
export const getSun = (): SunLight => sun;

// Moon disc info: direction toward the moon (ENU), whether it's up, the
// illuminated fraction + waxing flag (for the phase shape), and the disc colour.
export interface MoonLight {
  toward: [number, number, number]; up: boolean; fraction: number; waxing: boolean; disc: RGB;
}
let moon: MoonLight = {
  toward: [0.6, 1, 0.5], up: false, fraction: 1, waxing: false, disc: [232, 234, 244],
};
export const getMoon = (): MoonLight => moon;

let lastKey = '';
// Recompute the sky colours AND the sun light from the current position / date /
// time, so the terrain shading matches the time of day. Throttled to once per
// simulated minute; called each render.
export function updateSky(): void {
  if (!S.ready || !S.AF || !S.date) return;
  const utcSod = S.G0 + S.cur;                              // UTC seconds-of-day
  const key = S.date + '|' + Math.round(utcSod / 60);
  if (key === lastKey) return; lastKey = key;
  const ms = Date.parse(S.date + 'T00:00:00Z') + utcSod * 1000;
  if (!Number.isFinite(ms)) return;

  const { alt, az } = solar(ms, S.AF.lat, S.AF.lon);
  const altDeg = alt / RAD;

  // Sky gradient.
  const { zenith, horizon } = skyColors(altDeg);
  const css = document.documentElement.style;
  css.setProperty('--sky-zenith', `rgb(${zenith.join(',')})`);
  css.setProperty('--sky-horizon', `rgb(${horizon.join(',')})`);

  // Sun light: direction from the sun position, intensity fading to night,
  // colour warming near the horizon, ambient dimming after dark. The light
  // elevation is capped so it stays oblique even at noon — a near-overhead sun
  // hits the bright satellite texture face-on and washes it out to white/yellow.
  const altL = Math.min(alt, 52 * RAD);
  const day = clamp((altDeg + 4) / 10, 0, 1);               // 1 above ~6°, 0 below ~-4°
  const warm = clamp((10 - altDeg) / 24, 0, 0.8);           // warmer toward the horizon
  const ca = Math.cos(alt), sa = Math.sin(alt);
  sun = {
    dir: [Math.cos(altL) * Math.sin(az), Math.cos(altL) * Math.cos(az), -Math.sin(altL)],
    intensity: 1.4 * day,
    color: mix([255, 247, 232], [255, 165, 100], warm),
    ambient: 0.4 + 0.45 * day,
    // Unit vector toward the sun (ENU: east, north, up) at the real elevation.
    toward: [-ca * Math.sin(az), -ca * Math.cos(az), sa],
    up: altDeg > -0.5,
    disc: mix([255, 130, 62], [255, 250, 235], clamp((altDeg + 2) / 14, 0, 1)),
  };

  // Moon: position toward the moon, illuminated fraction + waxing for the phase
  // shape, disc colour warming toward the horizon.
  const d = days(ms), mp = moonRaDec(d), mh = horizonCoords(mp.ra, mp.dec, d, S.AF.lat, S.AF.lon);
  const il = moonIllumination(d), mAltDeg = mh.alt / RAD;
  const mca = Math.cos(mh.alt), msa = Math.sin(mh.alt);
  moon = {
    toward: [-mca * Math.sin(mh.az), -mca * Math.cos(mh.az), msa],
    up: mAltDeg > -0.5,
    fraction: il.fraction,
    waxing: il.phase < 0.5,
    disc: mix([224, 188, 150], [232, 234, 244], clamp((mAltDeg + 2) / 14, 0, 1)),
  };
}
