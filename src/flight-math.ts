// ============ the app's view of a flight ============
// The maths lives in core/flight.ts: where the glider was, how fast it climbed, how it was
// banked, what the flight added up to. What is left here is everything that needs the app —
// which track is the subject, which ones are shown, what the clock reads — plus the glider
// glyphs, which are geometry for a renderer.
import { S } from './state';
import { GLIDER, ARROW, LIVE, clampv } from './config';
import { isPowered } from './aircraft-mesh';
import type { RenderTrack, Pos3, RelPoint, TrackPoint } from './types';
import { M_PER_LAT, mPerLng } from './core/geo';
import {
  buildRel as buildRelCore, posAt as posAtCore, airborne as airborneCore, slice as sliceCore,
  headingAt as headingAtCore, varioAt as varioAtCore, groundSpeedAt as groundSpeedAtCore,
  compVarioAt as compVarioAtCore, flightStats, attitudeAt as attitudeAtCore,
  brg, type Attitude, type TrackStats, type Dynamics,
} from './core/flight';

export { brg };
export type { Attitude, TrackStats };

// The flight dynamics the attitude estimate needs — the physics half of GLIDER, without the
// marker's on-screen size.
const DYN: Dynamics = {
  g: GLIDER.g, dt: GLIDER.dt,
  maxBankDeg: GLIDER.maxBankDeg, maxPitchDeg: GLIDER.maxPitchDeg,
  pitchLevelSpeed: GLIDER.pitchLevelSpeed, pitchGain: GLIDER.pitchGain,
};

/** Build a track's render-ready points, applying the day's geoid/datum correction. */
export const buildRel = (path: TrackPoint[], G0: number, spline: boolean): RelPoint[] =>
  buildRelCore(path, G0, spline, S.altOffset);

export const posAt = (tr: RenderTrack, time: number): Pos3 => posAtCore(tr, time);
export const airborne = (tr: RenderTrack, time: number): boolean => airborneCore(tr, time);
export const slice = (tr: RenderTrack, t0: number, t1: number): Pos3[] => sliceCore(tr, t0, t1);
export const headingAt = (tr: RenderTrack, time: number): number => headingAtCore(tr, time);
export const varioAt = (tr: RenderTrack, time: number): number => varioAtCore(tr, time);
export const groundSpeedAt = (tr: RenderTrack, time: number): number => groundSpeedAtCore(tr, time, GLIDER.dt);
export const compVarioAt = (tr: RenderTrack, time: number): number => compVarioAtCore(tr, time, GLIDER.dt, GLIDER.g);
export const statsFor = (tr: RenderTrack): TrackStats => flightStats(tr, tr.maxalt);
export const attitudeAt = (tr: RenderTrack, time: number): Attitude =>
  attitudeAtCore(tr, time, isPowered(tr.type), DYN);

export function displayReg(tr: RenderTrack): string {
  if (!S.anon) return tr.reg;
  const i = S.TRACKS.indexOf(tr);
  return i >= 0 ? 'G' + (i + 1) : '—';
}

// Subdivisions inserted per beacon segment when spline smoothing is on.
/** The track currently followed in cockpit view. A glider may have several
 *  flights that day (same reg); follow the one airborne now, else its first. */
export const subjectTrack = (): RenderTrack => {
  const m = S.TRACKS.filter(tr => tr.reg === S.subject);
  return m.find(tr => airborne(tr, S.cur)) || m[0] || S.TRACKS[0];
};

/** Whether a track should be drawn (cockpit shows all; overview honours solo). */
export function shown(tr: RenderTrack): boolean {
  // Optional "active only" filter hides gliders not currently airborne — but never
  // the one you're following/focused on.
  if (S.activeOnly && tr.reg !== S.subject && tr.reg !== S.focus && !isActive(tr)) return false;
  if (S.mode === 'fpv') return true;
  return !S.solo || S.solo === tr.reg;
}

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

/** "Active" = drawn as a live marker right now (airborne in replay; online/recent
 *  in live). Drives the optional "active only" filter. */
export const isActive = (tr: RenderTrack): boolean => presence(tr) != null;


export const clampCur = (tr: RenderTrack): number => Math.max(tr.rstart, Math.min(tr.rend, S.cur));

// A glider attitude glyph at a time: a wing line + a fuselage line through the
// position, tilted by roll/pitch. Endpoints are [lon, lat, realAlt] (the caller
// applies vertical exaggeration). Right bank lowers the right wing; nose-up
// raises the front of the fuselage.
export function gliderShape(tr: RenderTrack, time: number): { wing: [Pos3, Pos3]; fuse: [Pos3, Pos3] } {
  const c = posAt(tr, time);
  const { heading, roll, pitch } = attitudeAt(tr, time);
  const h = heading * Math.PI / 180;
  const mLng = mPerLng(c[1]), mLat = M_PER_LAT;
  const fE = Math.sin(h), fN = Math.cos(h);   // forward (heading) unit, east/north
  const rE = Math.cos(h), rN = -Math.sin(h);  // right wing unit, east/north
  const { halfSpan: HS, halfLen: HL, wingPos } = GLIDER;
  const pt = (eOff: number, nOff: number, altOff: number): Pos3 => [c[0] + eOff / mLng, c[1] + nOff / mLat, c[2] + altOff];
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
  const mLng = mPerLng(c[1]), mLat = M_PER_LAT;
  const fE = Math.sin(h), fN = Math.cos(h);   // forward (heading) unit
  const rE = Math.cos(h), rN = -Math.sin(h);  // right unit
  const { len: L, back: B, halfW: W } = ARROW;
  const sp = Math.sin(pitch), sr = Math.sin(roll);
  const pt = (fwd: number, rgt: number): Pos3 =>
    [c[0] + (fE * fwd + rE * rgt) / mLng, c[1] + (fN * fwd + rN * rgt) / mLat, c[2] + fwd * sp - rgt * sr];
  return [pt(L, 0), pt(-B, -W), pt(-B, W)];
}

/** Format a relative time as a local HH:MM:SS clock string. */
/** Format a time of day (any real second count) as HH:MM[:SS], 24- or 12-hour
 *  (S.clock12). Wraps into [0, 86400) first, so a western time zone / midnight
 *  roll-over never yields negative H:M:S. */
export function fmtTod(sec: number, withSec = true): string {
  const s = (((Math.floor(sec)) % 86400) + 86400) % 86400;
  const z = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  const tail = withSec ? ':' + z(ss) : '';
  if (S.clock12) return `${((h + 11) % 12) + 1}:${z(m)}${tail} ${h < 12 ? 'AM' : 'PM'}`;
  return `${z(h)}:${z(m)}${tail}`;
}
/** The replay clock: airfield-local time (or UTC, S.clockUTC) for a relative second. */
export function fmt(secRel: number, withSec = true): string {
  const tz = S.clockUTC ? 0 : (S.AF ? S.AF.tz_off : 0);
  return fmtTod(S.G0 + secRel + tz * 3600, withSec);
}
/** Calendar-day offset of the displayed clock (UTC or local) vs the loaded day —
 *  the local day of the first beacon, taken as the loaded date. ±1 when a western
 *  time zone / UTC view rolls the time onto another day. */
export function dayShift(secRel: number): number {
  const tzo = (S.AF ? S.AF.tz_off : 0) * 3600;
  const ref = Math.floor((S.G0 + tzo) / 86400);            // local day-0 = the loaded date
  return Math.floor((S.G0 + secRel + (S.clockUTC ? 0 : tzo)) / 86400) - ref;
}
