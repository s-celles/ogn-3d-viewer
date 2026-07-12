// ============ where the sun and the moon are, and what colour that makes the sky ======
// Pure astronomy: a UTC instant and a place in, a sun/moon position out. No app state, no
// DOM, no CSS — updateSky (src/sky.ts) is what pushes these numbers into the scene. The
// thermal field needs the same sun geometry to know which slopes are being heated, and a
// flight computer needs it with no renderer at all.
export const RAD = Math.PI / 180;   // radians per degree

// Sun altitude + azimuth (radians) for a UTC instant and location. Compact
// SunCalc / NOAA solar-position formula. Azimuth follows SunCalc: measured from
// south, positive toward west.
export function solar(ms: number, lat: number, lon: number): { alt: number; az: number } {
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
export function days(ms: number): number {
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

// Subsolar point (deg) — where the sun is directly overhead at `ms`.
export function subsolar(ms: number): { lat: number; lon: number } {
  const d = days(ms), { ra, dec } = sunRaDec(d);
  let lon = ra * 180 / Math.PI - (280.16 + 360.9856235 * d);
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat: dec * 180 / Math.PI, lon };
}

// Region (web-mercator lng/lat ring) where the sun is BELOW altitude `altDeg` at
// `ms`. altDeg = 0 is the day/night terminator; negative values give the twilight
// bands (civil −6°, nautical −12°, astronomical −18°) that let us draw a soft
// gradient instead of a hard edge. The boundary latitude for a longitude solves
// sin(alt) = sinφ·sinδ + cosφ·cosδ·cosH; the region is closed off at the winter
// pole. Returns null near the equinox (dec≈0 → degenerate along meridians).
export function nightPolygon(ms: number, altDeg = 0): [number, number][] | null {
  const d = days(ms), { ra, dec } = sunRaDec(d);
  if (Math.abs(dec) < 0.06) return null;
  let lonSs = ra * 180 / Math.PI - (280.16 + 360.9856235 * d);
  lonSs = ((lonSs + 180) % 360 + 360) % 360 - 180;
  const a = Math.sin(dec), sinh = Math.sin(altDeg * Math.PI / 180);
  const clampLat = (x: number) => Math.max(-85, Math.min(85, x));
  const curve: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const H = (lon - lonSs) * Math.PI / 180, b = Math.cos(dec) * Math.cos(H);
    const R = Math.hypot(a, b) || 1e-9, s = Math.max(-1, Math.min(1, sinh / R)), psi = Math.atan2(b, a);
    const L = dec > 0 ? Math.asin(s) - psi : Math.PI - Math.asin(s) - psi;   // night-side root
    const lat = Math.atan2(Math.sin(L), Math.cos(L));                        // wrap to (−π, π]
    curve.push([lon, clampLat(lat * 180 / Math.PI)]);
  }
  const pole = dec > 0 ? -85 : 85;                  // winter pole = polar night
  return [[-180, pole], ...curve, [180, pole]];
}

// Moon geocentric ecliptic → equatorial coords + distance (km). SunCalc's
// low-precision lunar series — good to ~a few arcminutes, plenty for a sky disc.
export function moonRaDec(d: number): { ra: number; dec: number; dist: number } {
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
export function horizonCoords(ra: number, dec: number, d: number, lat: number, lon: number): { alt: number; az: number } {
  const th = RAD * (280.16 + 360.9856235 * d) + RAD * lon;
  const H = th - ra, phi = RAD * lat;
  return {
    alt: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
    az: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
  };
}

// Moon illuminated fraction (0..1) and phase (0 new → 0.5 full → 1 new; <0.5 is
// waxing, so the lit limb is on the right in the northern hemisphere).
export function moonIllumination(d: number): { fraction: number; phase: number } {
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

export type RGB = [number, number, number];
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

export const mix = (a: RGB, b: RGB, t: number): RGB =>
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
