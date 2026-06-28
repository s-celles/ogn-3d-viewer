// ============ track geometry & time helpers ============
import { S } from './state';
import { GLIDER, ARROW, LIVE, clampv } from './config';
import { isPowered } from './aircraft-mesh';
import type { RenderTrack, Pos3, RelPoint, TrackPoint } from './types';

// Subdivisions inserted per beacon segment when spline smoothing is on.
const SPLINE_SUBDIV = 8;

// Catmull-Rom basis for one coordinate: smooth curve through p1→p2 using the
// neighbouring control points p0 and p3.
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Densify a polyline with a Catmull-Rom spline through its points, keeping time
// monotonic (linearly interpolated within each segment). Returns the input
// untouched when there are too few points to interpolate.
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
  out.push(base[n - 1]); // final endpoint
  return out;
}

// Build a track's render-ready points from raw [lon,lat,alt,sod] beacons,
// shifting time by G0 and optionally smoothing with a Catmull-Rom spline.
export function buildRel(path: TrackPoint[], G0: number, spline: boolean): RelPoint[] {
  const dz = S.altOffset;   // geoid/datum correction (ellipsoidal → orthometric)
  const base = path.map(p => [p[0], p[1], p[2] - dz, p[3] - G0] as RelPoint);
  return spline ? densify(base) : base;
}

/** The track currently followed in cockpit view. */
export const subjectTrack = (): RenderTrack => S.TRACKS.find(tr => tr.reg === S.subject) || S.TRACKS[0];

/** Whether a track should be drawn (cockpit shows all; overview honours solo). */
export function shown(tr: RenderTrack): boolean { if (S.mode === 'fpv') return true; return !S.solo || S.solo === tr.reg; }

/**
 * The shown, currently-present track nearest the overview camera centre — the
 * focus candidate that cockpit/chase will follow. Distance is a cheap planar
 * approximation (degrees, longitude scaled by cos(lat)); good enough for ranking.
 * Uses presence() so it also works in live (last-known fix). Returns null when
 * no aircraft is present at the current time.
 */
export function nearestToCenter(): RenderTrack | null {
  const cx = S.mapVS.longitude, cy = S.mapVS.latitude, cosLat = Math.cos(cy * Math.PI / 180);
  let best: RenderTrack | null = null, bestD = Infinity;
  for (const tr of S.TRACKS) {
    const pr = shown(tr) ? presence(tr) : null;
    if (!pr) continue;
    const p = posAt(tr, pr.time), dx = (p[0] - cx) * cosLat, dy = p[1] - cy, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = tr; }
  }
  return best;
}

/** Track path with the current vertical exaggeration applied. */
export function scaled(tr: RenderTrack): Pos3[] { const k = S.exo; return tr.rel.map(p => [p[0], p[1], p[2] * k]); }

/** Interpolated [lon,lat,alt] at a given relative time. */
export function posAt(tr: RenderTrack, time: number): Pos3 {
  const P = tr.rel;
  if (time <= tr.rstart) return [P[0][0], P[0][1], P[0][2]];
  if (time >= tr.rend) { const e = P[P.length - 1]; return [e[0], e[1], e[2]]; }
  for (let i = 1; i < P.length; i++) {
    if (P[i][3] >= time) {
      const a = P[i - 1], b = P[i], f = (time - a[3]) / Math.max(1e-3, b[3] - a[3]);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  const e = P[P.length - 1]; return [e[0], e[1], e[2]];
}

export const airborne = (tr: RenderTrack, time: number): boolean => time >= tr.rstart && time <= tr.rend;

export interface Presence { time: number; offline: boolean; }

/**
 * Whether an aircraft should be drawn as a live marker now, and at what time.
 * Replay: only while airborne, at the cursor (never "offline"). Live: the cursor
 * (real time) runs a little ahead of the last beacon, so freeze the aircraft at
 * its last-known fix; flag it "offline" once that fix goes stale, and drop it
 * once it's too old (landed / gone). Mirrors the FlightBook live map's
 * online/offline split.
 */
export function presence(tr: RenderTrack): Presence | null {
  if (!S.live) return airborne(tr, S.cur) ? { time: S.cur, offline: false } : null;
  if (S.cur < tr.rstart) return null;                       // not started today
  const age = S.cur - tr.rend;                              // s since last beacon
  if (age > LIVE.offlineMaxAge) return null;                // landed / gone
  return { time: Math.min(S.cur, tr.rend), offline: age > LIVE.onlineMaxAge };
}

/** Path points between two relative times (clamped to the track span). */
export function slice(tr: RenderTrack, t0: number, t1: number): Pos3[] {
  t0 = Math.max(t0, tr.rstart); t1 = Math.min(t1, tr.rend); if (t1 <= t0) return [];
  const out: Pos3[] = [posAt(tr, t0)];
  for (const p of tr.rel) { if (p[3] > t0 && p[3] < t1) out.push([p[0], p[1], p[2]]); }
  out.push(posAt(tr, t1)); return out;
}

/** Bearing (degrees) from point a to point b, or null if they coincide. */
export function brg(a: Pos3, b: Pos3): number | null {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180, e = (b[0] - a[0]) * Math.cos(lat), n = (b[1] - a[1]);
  if (Math.abs(e) < 1e-9 && Math.abs(n) < 1e-9) return null;
  return (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
}

export function headingAt(tr: RenderTrack, time: number): number {
  return brg(posAt(tr, Math.max(tr.rstart, time - 3)), posAt(tr, Math.min(tr.rend, time + 3))) ?? 0;
}

// Raw (geometric) vario: rate of altitude change. Used for the flight-path angle.
export function varioAt(tr: RenderTrack, time: number): number {
  const t0 = Math.max(tr.rstart, time - 4), t1 = Math.min(tr.rend, time + 4), a = posAt(tr, t0), b = posAt(tr, t1), dt = t1 - t0;
  return dt > 0 ? (b[2] - a[2]) / dt : 0;
}

// Horizontal ground speed (m/s) estimated over a ±dt window.
export function groundSpeedAt(tr: RenderTrack, time: number): number {
  const dt = GLIDER.dt;
  const t0 = Math.max(tr.rstart, time - dt), t1 = Math.min(tr.rend, time + dt), span = (t1 - t0) || 1;
  const a = posAt(tr, t0), b = posAt(tr, t1);
  const latMid = (a[1] + b[1]) / 2 * Math.PI / 180;
  const dE = (b[0] - a[0]) * 111320 * Math.cos(latMid), dN = (b[1] - a[1]) * 111320;
  return Math.hypot(dE, dN) / span;
}

// Total-energy (compensated) vario: raw vario plus the kinetic-energy term
// (V/g)·dV/dt, so a pull-up that trades speed for height no longer reads as lift.
//
// Physically V must be the TRUE AIRSPEED (the glider's energy is relative to the
// air mass), NOT ground speed. OGN/GPS gives us no airspeed and no wind, so we
// substitute GPS ground speed. This is exact only in still air; a steady wind
// biases the result (most on downwind/upwind transitions). It is a deliberate
// GPS approximation, not a true TE vario — see groundSpeedAt, never call it
// airspeed.
export function compVarioAt(tr: RenderTrack, time: number): number {
  const dt = GLIDER.dt;
  const t0 = Math.max(tr.rstart, time - dt), t1 = Math.min(tr.rend, time + dt), span = (t1 - t0) || 1;
  const dVdt = (groundSpeedAt(tr, t1) - groundSpeedAt(tr, t0)) / span;
  return varioAt(tr, time) + groundSpeedAt(tr, time) * dVdt / GLIDER.g;
}

export const clampCur = (tr: RenderTrack): number => Math.max(tr.rstart, Math.min(tr.rend, S.cur));

export interface TrackStats {
  dur: number;       // flight duration (s)
  maxAlt: number;    // max altitude (m)
  gain: number;      // cumulative climb (m, sum of positive Δalt)
  distKm: number;    // ground distance flown (km)
  avgKmh: number;    // average ground speed (km/h)
  maxKmh: number;    // 98th-percentile ground speed (km/h, glitch-robust)
  maxClimb: number;  // 98th-percentile climb rate (m/s)
}

// Per-track summary stats from a single O(n) pass over the (spline) samples — no
// posAt, so it stays cheap even for densified IGC tracks. Speed/climb maxima are
// resampled into ~4 s windows then taken at the 98th percentile, so a single
// glitch beacon can't blow up the figures.
export function statsFor(tr: RenderTrack): TrackStats {
  const P = tr.rel;
  let gain = 0, dist = 0, wHoriz = 0, wDz = 0, wT = 0;
  const speeds: number[] = [], climbs: number[] = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], dt = b[3] - a[3];
    if (dt <= 0) continue;
    const dz = b[2] - a[2], lat = (a[1] + b[1]) / 2 * Math.PI / 180;
    const dE = (b[0] - a[0]) * 111320 * Math.cos(lat), dN = (b[1] - a[1]) * 111320, seg = Math.hypot(dE, dN);
    dist += seg; if (dz > 0) gain += dz;
    wHoriz += seg; wDz += dz; wT += dt;
    if (wT >= 4) { speeds.push(wHoriz / wT); climbs.push(wDz / wT); wHoriz = wDz = wT = 0; }
  }
  const dur = tr.rend - tr.rstart;
  speeds.sort((x, y) => x - y); climbs.sort((x, y) => x - y);
  const pct = (arr: number[], q: number) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * arr.length))] : 0;
  return {
    dur, maxAlt: tr.maxalt, gain, distKm: dist / 1000,
    avgKmh: dur > 0 ? dist / dur * 3.6 : 0,
    maxKmh: pct(speeds, 0.98) * 3.6,
    maxClimb: pct(climbs, 0.98),
  };
}

export interface Attitude { heading: number; roll: number; pitch: number; speed: number; }

// Estimate the aircraft's attitude at a time: ground speed and turn rate from a
// ±dt window, bank from the coordinated-turn relation tan(roll)=V·ω/g. Roll>0 =
// right bank, pitch>0 = nose up. Both angles are clamped to the configured
// maxima. Angles in radians.
//
// Pitch depends on aircraft type. A GLIDER is always descending through the air,
// so it never holds a nose-up attitude in normal flight: its body pitch is set
// by airspeed (ground-speed proxy) — ~level near stall, increasingly nose-down
// as it speeds up — independent of climb rate (thermals don't pitch the nose
// up). A POWERED aircraft can climb under power, so it keeps the flight-path
// angle (vario / speed) and pitches up when climbing.
export function attitudeAt(tr: RenderTrack, time: number): Attitude {
  const { dt, g } = GLIDER;
  const maxBank = GLIDER.maxBankDeg * Math.PI / 180, maxPitch = GLIDER.maxPitchDeg * Math.PI / 180;
  const t0 = Math.max(tr.rstart, time - dt), t1 = Math.min(tr.rend, time + dt), span = (t1 - t0) || 1;
  const speed = groundSpeedAt(tr, time);                            // ground speed (m/s)
  let dh = ((headingAt(tr, t1) - headingAt(tr, t0) + 540) % 360) - 180; // signed heading change (deg), right +
  const omega = (dh * Math.PI / 180) / span;                        // turn rate (rad/s)
  const roll = clampv(Math.atan(speed * omega / g), -maxBank, maxBank);
  const pitch = isPowered(tr.type)
    ? clampv(Math.atan2(varioAt(tr, time), Math.max(1, speed)), -maxPitch, maxPitch)
    : clampv(-Math.max(0, speed - GLIDER.pitchLevelSpeed) * GLIDER.pitchGain, -maxPitch, 0);
  return { heading: headingAt(tr, time), roll, pitch, speed };
}

// A glider attitude glyph at a time: a wing line + a fuselage line through the
// position, tilted by roll/pitch. Endpoints are [lon, lat, realAlt] (the caller
// applies vertical exaggeration). Right bank lowers the right wing; nose-up
// raises the front of the fuselage.
export function gliderShape(tr: RenderTrack, time: number): { wing: [Pos3, Pos3]; fuse: [Pos3, Pos3] } {
  const c = posAt(tr, time);
  const { heading, roll, pitch } = attitudeAt(tr, time);
  const h = heading * Math.PI / 180;
  const mPerLng = 111320 * Math.cos(c[1] * Math.PI / 180), mPerLat = 111320;
  const fE = Math.sin(h), fN = Math.cos(h);   // forward (heading) unit, east/north
  const rE = Math.cos(h), rN = -Math.sin(h);  // right wing unit, east/north
  const { halfSpan: HS, halfLen: HL, wingPos } = GLIDER;
  const pt = (eOff: number, nOff: number, altOff: number): Pos3 => [c[0] + eOff / mPerLng, c[1] + nOff / mPerLat, c[2] + altOff];
  // Wings cross the fuselage `wingPos·halfLen` ahead of the position; the crossing
  // sits on the pitched fuselage, so its altitude follows the pitch at that point.
  const fwd = wingPos * HL, wingAlt = fwd * Math.sin(pitch);
  const right = pt(fE * fwd + rE * HS, fN * fwd + rN * HS, wingAlt - HS * Math.sin(roll));
  const left = pt(fE * fwd - rE * HS, fN * fwd - rN * HS, wingAlt + HS * Math.sin(roll));
  const nose = pt(fE * HL, fN * HL, HL * Math.sin(pitch));
  const tail = pt(-fE * HL, -fN * HL, -HL * Math.sin(pitch));
  return { wing: [left, right], fuse: [tail, nose] };
}

// A triangle marking the glider position, pointing along the heading (nose
// ahead, base behind) and tilted to the glider's attitude (banks in turns,
// pitches with climb). Endpoints are [lon, lat, realAlt]; the caller applies
// vertical exaggeration. A point at body offset (forward, right) sits at
// altitude forward·sin(pitch) − right·sin(roll), like the wing/fuselage glyph.
export function gliderArrow(tr: RenderTrack, time: number): [Pos3, Pos3, Pos3] {
  const c = posAt(tr, time);
  const { heading, roll, pitch } = attitudeAt(tr, time);
  const h = heading * Math.PI / 180;
  const mPerLng = 111320 * Math.cos(c[1] * Math.PI / 180), mPerLat = 111320;
  const fE = Math.sin(h), fN = Math.cos(h);   // forward (heading) unit
  const rE = Math.cos(h), rN = -Math.sin(h);  // right unit
  const { len: L, back: B, halfW: W } = ARROW;
  const sp = Math.sin(pitch), sr = Math.sin(roll);
  const pt = (fwd: number, rgt: number): Pos3 =>
    [c[0] + (fE * fwd + rE * rgt) / mPerLng, c[1] + (fN * fwd + rN * rgt) / mPerLat, c[2] + fwd * sp - rgt * sr];
  return [pt(L, 0), pt(-B, -W), pt(-B, W)];
}

/** Format a relative time as a local HH:MM:SS clock string. */
export function fmt(secRel: number): string {
  const utc = S.G0 + secRel + (S.AF ? S.AF.tz_off : 0) * 3600, z = (n: number) => String(n).padStart(2, '0');
  return `${z(Math.floor(utc / 3600) % 24)}:${z(Math.floor(utc / 60) % 60)}:${z(Math.floor(utc) % 60)}`;
}
