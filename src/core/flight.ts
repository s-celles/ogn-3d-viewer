// ============ a flight, as numbers ============
// Where the glider was at time t, how fast it was going, how fast it was climbing, how it was
// banked, and what the whole flight added up to. All of it follows from the track alone — no
// app state, no renderer, no config object. A flight computer needs exactly this, and it has
// no map to draw it on.
import { M_PER_LAT, bearingDeg, rad } from './geo';
import type { Pos3, RelPoint, TrackPoint } from './types';

/** A track resampled onto day-relative time: the only thing any of this needs. */
export interface FlightPath {
  rel: RelPoint[];      // [lon, lat, alt, relTime], time-ordered
  rstart: number;
  rend: number;
}

// ---- building the path ----

const SPLINE_SUBDIV = 8;

/** Catmull-Rom: a curve through its control points (unlike a Bézier), so a smoothed track
 *  still passes through every beacon the receiver actually heard. */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function densify(base: RelPoint[]): RelPoint[] {
  const n = base.length;
  if (n < 3) return base;
  const out: RelPoint[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = base[Math.max(0, i - 1)], p1 = base[i], p2 = base[i + 1], p3 = base[Math.min(n - 1, i + 2)];
    for (let s = 0; s < SPLINE_SUBDIV; s++) {
      const t = s / SPLINE_SUBDIV;
      out.push([
        catmull(p0[0], p1[0], p2[0], p3[0], t),
        catmull(p0[1], p1[1], p2[1], p3[1], t),
        catmull(p0[2], p1[2], p2[2], p3[2], t),
        p1[3] + (p2[3] - p1[3]) * t,
      ]);
    }
  }
  out.push(base[n - 1]);   // final endpoint
  return out;
}

/** Render-ready points from raw [lon, lat, alt, sod] beacons: shift time by the day's origin,
 *  correct the altitude datum (ellipsoidal → orthometric), and optionally smooth with a spline.
 *  Fewer than 3 points cannot be splined, so they stay linear. */
export function buildRel(path: TrackPoint[], G0: number, spline: boolean, altOffset: number): RelPoint[] {
  const base = path.map(p => [p[0], p[1], p[2] - altOffset, p[3] - G0] as RelPoint);
  return spline ? densify(base) : base;
}

// ---- reading it ----

/** Interpolated [lon, lat, alt] at a relative time, clamped to the ends of the track. */
export function posAt(p: FlightPath, time: number): Pos3 {
  const P = p.rel;
  if (time <= p.rstart) return [P[0][0], P[0][1], P[0][2]];
  if (time >= p.rend) { const e = P[P.length - 1]; return [e[0], e[1], e[2]]; }
  for (let i = 1; i < P.length; i++) {
    if (P[i][3] >= time) {
      const a = P[i - 1], b = P[i], f = (time - a[3]) / Math.max(1e-3, b[3] - a[3]);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  const e = P[P.length - 1];
  return [e[0], e[1], e[2]];
}

export const airborne = (p: FlightPath, time: number): boolean => time >= p.rstart && time <= p.rend;

/** The track between two times, with interpolated endpoints. */
export function slice(p: FlightPath, t0: number, t1: number): Pos3[] {
  t0 = Math.max(t0, p.rstart); t1 = Math.min(t1, p.rend);
  if (t1 <= t0) return [];
  const out: Pos3[] = [posAt(p, t0)];
  for (const q of p.rel) if (q[3] > t0 && q[3] < t1) out.push([q[0], q[1], q[2]]);
  out.push(posAt(p, t1));
  return out;
}

/** Bearing (deg) from a to b, or null when they coincide. */
export function brg(a: Pos3, b: Pos3): number | null {
  const lat = rad((a[1] + b[1]) / 2), e = (b[0] - a[0]) * Math.cos(lat), n = b[1] - a[1];
  if (Math.abs(e) < 1e-9 && Math.abs(n) < 1e-9) return null;
  return bearingDeg(a[0], a[1], b[0], b[1]);
}

export function headingAt(p: FlightPath, time: number): number {
  return brg(posAt(p, Math.max(p.rstart, time - 3)), posAt(p, Math.min(p.rend, time + 3))) ?? 0;
}

/** Raw (geometric) vario: the rate of altitude change. */
export function varioAt(p: FlightPath, time: number): number {
  const t0 = Math.max(p.rstart, time - 4), t1 = Math.min(p.rend, time + 4);
  const a = posAt(p, t0), b = posAt(p, t1), dt = t1 - t0;
  return dt > 0 ? (b[2] - a[2]) / dt : 0;
}

/** Horizontal GROUND speed (m/s) over a ±dt window. Not airspeed — see compVarioAt. */
export function groundSpeedAt(p: FlightPath, time: number, dt: number): number {
  const t0 = Math.max(p.rstart, time - dt), t1 = Math.min(p.rend, time + dt), span = (t1 - t0) || 1;
  const a = posAt(p, t0), b = posAt(p, t1);
  const latMid = rad((a[1] + b[1]) / 2);
  const dE = (b[0] - a[0]) * M_PER_LAT * Math.cos(latMid), dN = (b[1] - a[1]) * M_PER_LAT;
  return Math.hypot(dE, dN) / span;
}

/** Total-energy (compensated) vario: the raw vario plus the kinetic term (V/g)·dV/dt, so a
 *  pull-up that trades speed for height no longer reads as lift.
 *
 *  Physically V must be the TRUE AIRSPEED — the glider's energy is relative to the air mass —
 *  NOT ground speed. OGN/GPS gives us neither airspeed nor wind, so ground speed stands in.
 *  That is exact only in still air; a steady wind biases the result, most on downwind/upwind
 *  transitions. A deliberate GPS approximation, not a true TE vario. Never call it airspeed. */
export function compVarioAt(p: FlightPath, time: number, dt: number, g: number): number {
  const t0 = Math.max(p.rstart, time - dt), t1 = Math.min(p.rend, time + dt), span = (t1 - t0) || 1;
  const dVdt = (groundSpeedAt(p, t1, dt) - groundSpeedAt(p, t0, dt)) / span;
  return varioAt(p, time) + groundSpeedAt(p, time, dt) * dVdt / g;
}

// ---- the flight as a whole ----

export interface TrackStats {
  dur: number;       // flight duration (s)
  maxAlt: number;    // max altitude (m)
  gain: number;      // cumulative climb (m, sum of positive Δalt)
  distKm: number;    // ground distance flown (km)
  avgKmh: number;    // average ground speed (km/h)
  maxKmh: number;    // 98th-percentile ground speed (km/h, glitch-robust)
  maxClimb: number;  // 98th-percentile climb rate (m/s)
}

/** Summary stats in a single O(n) pass over the samples — no posAt, so it stays cheap even on
 *  a densified IGC track. The maxima are resampled into ~4 s windows and taken at the 98th
 *  percentile, so one glitched beacon cannot blow the figures up. */
export function flightStats(p: FlightPath, maxAlt: number): TrackStats {
  const P = p.rel;
  let gain = 0, dist = 0, wHoriz = 0, wDz = 0, wT = 0;
  const speeds: number[] = [], climbs: number[] = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], dt = b[3] - a[3];
    if (dt <= 0) continue;
    const dz = b[2] - a[2], lat = rad((a[1] + b[1]) / 2);
    const dE = (b[0] - a[0]) * M_PER_LAT * Math.cos(lat), dN = (b[1] - a[1]) * M_PER_LAT;
    const seg = Math.hypot(dE, dN);
    dist += seg;
    if (dz > 0) gain += dz;
    wHoriz += seg; wDz += dz; wT += dt;
    if (wT >= 4) { speeds.push(wHoriz / wT); climbs.push(wDz / wT); wHoriz = wDz = wT = 0; }
  }
  const dur = p.rend - p.rstart;
  speeds.sort((x, y) => x - y); climbs.sort((x, y) => x - y);
  const pct = (arr: number[], q: number) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * arr.length))] : 0;
  return {
    dur, maxAlt, gain, distKm: dist / 1000,
    avgKmh: dur > 0 ? dist / dur * 3.6 : 0,
    maxKmh: pct(speeds, 0.98) * 3.6,
    maxClimb: pct(climbs, 0.98),
  };
}

// ---- attitude ----

export interface Attitude { heading: number; roll: number; pitch: number; speed: number }

/** The dynamics the attitude estimate needs. Not the marker's size on screen — that is the
 *  renderer's business — but the physics: gravity, the estimation window, and the caps that
 *  keep a noisy OGN track from producing an absurd attitude. */
export interface Dynamics {
  g: number; dt: number;
  maxBankDeg: number; maxPitchDeg: number;
  pitchLevelSpeed: number; pitchGain: number;
}

const clampv = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Attitude at a time: ground speed and turn rate over a ±dt window, bank from the
 *  coordinated-turn relation tan(roll) = V·ω/g. Roll > 0 = right bank, pitch > 0 = nose up.
 *  Angles in radians, both clamped.
 *
 *  Pitch depends on what is flying. A GLIDER is always descending through the air, so it never
 *  holds a nose-up attitude in normal flight: its body pitch follows airspeed (ground speed
 *  standing in) — near level at low speed, increasingly nose-down as it accelerates — and is
 *  INDEPENDENT of climb rate, because a thermal does not pitch the nose up. A POWERED aircraft
 *  can climb under power, so it keeps the flight-path angle and pitches up when climbing. */
export function attitudeAt(p: FlightPath, time: number, powered: boolean, d: Dynamics): Attitude {
  const maxBank = rad(d.maxBankDeg), maxPitch = rad(d.maxPitchDeg);
  const t0 = Math.max(p.rstart, time - d.dt), t1 = Math.min(p.rend, time + d.dt), span = (t1 - t0) || 1;
  const speed = groundSpeedAt(p, time, d.dt);
  const dh = ((headingAt(p, t1) - headingAt(p, t0) + 540) % 360) - 180;   // signed heading change (deg), right +
  const omega = rad(dh) / span;                                           // turn rate (rad/s)
  const roll = clampv(Math.atan(speed * omega / d.g), -maxBank, maxBank);
  const pitch = powered
    ? clampv(Math.atan2(varioAt(p, time), Math.max(1, speed)), -maxPitch, maxPitch)
    : clampv(-Math.max(0, speed - d.pitchLevelSpeed) * d.pitchGain, -maxPitch, 0);
  return { heading: headingAt(p, time), roll, pitch, speed };
}
