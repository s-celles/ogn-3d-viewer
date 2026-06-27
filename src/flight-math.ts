// ============ track geometry & time helpers ============
import { S } from './state';
import { GLIDER, clampv } from './config';
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
  const base = path.map(p => [p[0], p[1], p[2], p[3] - G0] as RelPoint);
  return spline ? densify(base) : base;
}

/** The track currently followed in cockpit view. */
export const subjectTrack = (): RenderTrack => S.TRACKS.find(tr => tr.reg === S.subject) || S.TRACKS[0];

/** Whether a track should be drawn (cockpit shows all; overview honours solo). */
export function shown(tr: RenderTrack): boolean { if (S.mode === 'fpv') return true; return !S.solo || S.solo === tr.reg; }

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

export function varioAt(tr: RenderTrack, time: number): number {
  const t0 = Math.max(tr.rstart, time - 4), t1 = Math.min(tr.rend, time + 4), a = posAt(tr, t0), b = posAt(tr, t1), dt = t1 - t0;
  return dt > 0 ? (b[2] - a[2]) / dt : 0;
}

export const clampCur = (tr: RenderTrack): number => Math.max(tr.rstart, Math.min(tr.rend, S.cur));

export interface Attitude { heading: number; roll: number; pitch: number; speed: number; }

// Estimate the glider's attitude at a time: ground speed and turn rate from a
// ±dt window, bank from the coordinated-turn relation tan(roll)=V·ω/g, pitch
// from the flight-path angle (vario / speed). Roll>0 = right bank, pitch>0 = nose up.
// Both angles are clamped to the configured maxima. Angles in radians.
export function attitudeAt(tr: RenderTrack, time: number): Attitude {
  const { dt, g } = GLIDER;
  const maxBank = GLIDER.maxBankDeg * Math.PI / 180, maxPitch = GLIDER.maxPitchDeg * Math.PI / 180;
  const t0 = Math.max(tr.rstart, time - dt), t1 = Math.min(tr.rend, time + dt), span = (t1 - t0) || 1;
  const a = posAt(tr, t0), b = posAt(tr, t1);
  const latMid = (a[1] + b[1]) / 2 * Math.PI / 180;
  const dEast = (b[0] - a[0]) * 111320 * Math.cos(latMid), dNorth = (b[1] - a[1]) * 111320;
  const speed = Math.hypot(dEast, dNorth) / span;                  // ground speed (m/s)
  let dh = ((headingAt(tr, t1) - headingAt(tr, t0) + 540) % 360) - 180; // signed heading change (deg), right +
  const omega = (dh * Math.PI / 180) / span;                        // turn rate (rad/s)
  const roll = clampv(Math.atan(speed * omega / g), -maxBank, maxBank);
  const pitch = clampv(Math.atan2(varioAt(tr, time), Math.max(1, speed)), -maxPitch, maxPitch);
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
  const { halfSpan: HS, halfLen: HL } = GLIDER;
  const pt = (eOff: number, nOff: number, altOff: number): Pos3 => [c[0] + eOff / mPerLng, c[1] + nOff / mPerLat, c[2] + altOff];
  const right = pt(rE * HS, rN * HS, -HS * Math.sin(roll));
  const left = pt(-rE * HS, -rN * HS, HS * Math.sin(roll));
  const nose = pt(fE * HL, fN * HL, HL * Math.sin(pitch));
  const tail = pt(-fE * HL, -fN * HL, -HL * Math.sin(pitch));
  return { wing: [left, right], fuse: [tail, nose] };
}

/** Format a relative time as a local HH:MM:SS clock string. */
export function fmt(secRel: number): string {
  const utc = S.G0 + secRel + (S.AF ? S.AF.tz_off : 0) * 3600, z = (n: number) => String(n).padStart(2, '0');
  return `${z(Math.floor(utc / 3600) % 24)}:${z(Math.floor(utc / 60) % 60)}:${z(Math.floor(utc) % 60)}`;
}
