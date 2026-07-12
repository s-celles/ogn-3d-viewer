// ============ thermals, reconstructed from the gliders that found them ============
// A glider circling while it gains height IS a thermal marker. We find every circling-climb
// run across the tracks and merge the ones that overlap in space and time — several gliders
// in one thermal are one thermal. The pair of centres (early, late) encodes the wind drift,
// so the column can lean the way the real one did.
//
// The hard part is telling a thermal from a ridge beat: both climb, both turn. A full 360°
// of net heading is what separates them, and it is the reason MIN_TURN exists.
import { sampleProbe, netTurn, rates, runs, mergeClimbs, type Samp } from './probe';
import { M_PER_LAT, mPerLng } from './geo';
import type { Probe } from './ports';

export interface Thermal {
  t0: number; t1: number;         // active window (relative seconds)
  base: number; top: number;      // altitude band (m)
  strength: number;               // representative climb (m/s)
  c0: [number, number];           // centre (lon,lat) early in the climb
  c1: [number, number];           // centre (lon,lat) late — the pair encodes the wind drift
}

export const STEP = 3;           // resample step (s)
export const W = 9;              // s: heading baseline half-window — smooths ~10 s beacon noise
export const TURN_MIN = 4;       // deg/s: sustained turn rate that counts as circling
export const GAP = 21;           // s: bridge brief circling interruptions, so a climb stays one thermal
export const MIN_RUN = 24;       // s: shortest circling run kept
export const MIN_TURN = 360;     // deg: net heading swept (≥1 full turn) — this is what rejects ridge S-turns
export const MIN_GAIN = 80;      // m: shortest climb kept
export const MIN_STRENGTH = 0.3; // m/s: weakest climb kept
export const MERGE_M = 500;      // m: centres closer than this (with overlapping time) are one thermal
export const MAX_THERMALS = 60;  // cap, strongest first

const meanPos = (ss: Samp[]): [number, number] => {
  let x = 0, y = 0;
  for (const s of ss) { x += s.lon; y += s.lat; }
  return [x / ss.length, y / ss.length];
};

function makeThermal(run: Samp[]): Thermal | null {
  const t0 = run[0].t, t1 = run[run.length - 1].t, dur = t1 - t0;
  if (dur < MIN_RUN) return null;
  if (Math.abs(netTurn(run)) < MIN_TURN) return null;      // not really circling (e.g. ridge beats)
  let base = Infinity, top = -Infinity;
  for (const s of run) { base = Math.min(base, s.alt); top = Math.max(top, s.alt); }
  const gain = top - base;
  if (gain < MIN_GAIN) return null;
  const strength = gain / dur;
  if (strength < MIN_STRENGTH) return null;
  const k = Math.max(1, Math.floor(run.length / 3));
  return { t0, t1, base, top, strength, c0: meanPos(run.slice(0, k)), c1: meanPos(run.slice(-k)) };
}

/** Every circling-climb run in one probe. */
export function detectClimbs(p: Probe): Thermal[] {
  const out: Thermal[] = [];
  if (p.rend - p.rstart < MIN_RUN) return out;
  const s = sampleProbe(p, STEP, W);
  const g = Math.max(1, Math.round(W / STEP));
  const circling = s.map((_, i) => rates(s, i, g, STEP).turn >= TURN_MIN);
  for (const [from, to] of runs(circling, STEP, GAP)) {
    const th = makeThermal(s.slice(from, to + 1));
    if (th) out.push(th);
  }
  return out;
}

const mid = (th: Thermal): [number, number] => [(th.c0[0] + th.c1[0]) / 2, (th.c0[1] + th.c1[1]) / 2];

/** The day's thermals: detected across every probe, merged where they are the same air, and
 *  capped strongest-first. */
export function detectThermals(probes: readonly Probe[], max = MAX_THERMALS): Thermal[] {
  const all: Thermal[] = [];
  for (const p of probes) all.push(...detectClimbs(p));
  return mergeClimbs(all, mid, MERGE_M, (m, th) => {
    m.t0 = Math.min(m.t0, th.t0); m.t1 = Math.max(m.t1, th.t1);
    m.base = Math.min(m.base, th.base); m.top = Math.max(m.top, th.top);
    m.strength = Math.max(m.strength, th.strength);
    m.c0 = [(m.c0[0] + th.c0[0]) / 2, (m.c0[1] + th.c0[1]) / 2];
    m.c1 = [(m.c1[0] + th.c1[0]) / 2, (m.c1[1] + th.c1[1]) / 2];
  }).sort((a, b) => b.strength - a.strength).slice(0, max);
}

/** The mean drift of the observed thermals (m/s, east/north) — the wind, read off the air
 *  itself. Null when nothing was detected. The last-resort wind when there is no forecast. */
export function thermalDrift(ths: readonly Thermal[]): [number, number] | null {
  if (!ths.length) return null;
  let u = 0, v = 0;
  for (const th of ths) {
    const dur = Math.max(1, th.t1 - th.t0);
    const lat = (th.c0[1] + th.c1[1]) / 2;
    u += (th.c1[0] - th.c0[0]) / dur * mPerLng(lat);
    v += (th.c1[1] - th.c0[1]) / dur * M_PER_LAT;
  }
  return [u / ths.length, v / ths.length];
}
