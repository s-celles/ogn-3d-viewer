// ============ observed wave: the straight climbs the thermal detector throws away =======
// A thermal climb circles; a WAVE climb is smooth and nearly straight — the glider beats into
// wind, well above the ridges. The thermal detector demands a full 360° of net heading, so it
// rejects wave by construction. This is the mirror image: sustained climbs with a LOW turn
// rate and a good height above the ground.
//
// That last condition is what separates wave from a ridge beat, which is also straight and
// also climbs — but hugs the terrain. Hence AGL_MIN, and hence the elevation sampler.
import { sampleProbe, netTurn, rates, runs, mergeClimbs, type Samp } from './probe';
import type { ElevSampler, Probe } from './ports';

export interface WaveClimb {
  t0: number; t1: number;
  base: number; top: number;
  strength: number;
  c: [number, number];            // centre (lon,lat)
  hdg: number;                    // mean heading (deg) — the beat direction
}

export const STEP = 4;            // resample step (s)
export const HW = 10;             // s: heading baseline half-window
export const TURN_MAX = 3.2;      // deg/s: below this the flight is "straight" (not circling)
export const CLIMB_MIN = 0.25;    // m/s: minimum sustained climb over the window
export const GAP = 30;            // s: bridge brief interruptions
export const MIN_RUN = 90;        // s: shortest wave climb kept (waves are long)
export const MIN_GAIN = 200;      // m: shortest climb kept
export const MIN_STRENGTH = 0.4;  // m/s: weakest climb kept
export const MAX_NET = 300;       // deg: net heading swept must stay below this (else it is circling)
export const AGL_MIN = 250;       // m: the top must clear the terrain by this — this is what excludes ridge beats
export const MERGE_M = 900;       // m: merge nearby climbs (same wave, several beats or gliders)
export const MAX_WAVE = 40;       // cap, strongest first

function makeWave(run: Samp[], elev: ElevSampler): WaveClimb | null {
  const t0 = run[0].t, t1 = run[run.length - 1].t, dur = t1 - t0;
  if (dur < MIN_RUN) return null;
  if (Math.abs(netTurn(run)) > MAX_NET) return null;         // really circling → not wave
  let base = Infinity, top = -Infinity, cx = 0, cy = 0, hx = 0, hy = 0;
  for (const s of run) {
    base = Math.min(base, s.alt); top = Math.max(top, s.alt);
    cx += s.lon; cy += s.lat;
    hx += Math.sin(s.hdg * Math.PI / 180); hy += Math.cos(s.hdg * Math.PI / 180);
  }
  const gain = top - base; if (gain < MIN_GAIN) return null;
  const strength = gain / dur; if (strength < MIN_STRENGTH) return null;
  const c: [number, number] = [cx / run.length, cy / run.length];
  const g = elev(c[0], c[1]);
  if (g != null && top - g < AGL_MIN) return null;            // too close to the ground → a ridge beat
  return { t0, t1, base, top, strength, c, hdg: (Math.atan2(hx, hy) * 180 / Math.PI + 360) % 360 };
}

/** Every straight sustained climb in one probe. */
export function detectWaveClimbs(p: Probe, elev: ElevSampler): WaveClimb[] {
  const out: WaveClimb[] = [];
  if (p.rend - p.rstart < MIN_RUN) return out;
  const s = sampleProbe(p, STEP, HW);
  if (s.length < 4) return out;
  const g = Math.max(1, Math.round(HW / STEP));
  const straightClimb = s.map((_, i) => {
    const r = rates(s, i, g, STEP);
    return r.turn < TURN_MAX && r.climb > CLIMB_MIN;
  });
  for (const [from, to] of runs(straightClimb, STEP, GAP)) {
    const w = makeWave(s.slice(from, to + 1), elev);
    if (w) out.push(w);
  }
  return out;
}

/** The day's observed wave: detected across every probe, merged where several beats or several
 *  gliders worked the same bar, and capped strongest-first. */
export function detectWave(probes: readonly Probe[], elev: ElevSampler, max = MAX_WAVE): WaveClimb[] {
  const all: WaveClimb[] = [];
  for (const p of probes) all.push(...detectWaveClimbs(p, elev));
  return mergeClimbs(all, w => w.c, MERGE_M, (m, w) => {
    m.t0 = Math.min(m.t0, w.t0); m.t1 = Math.max(m.t1, w.t1);
    m.base = Math.min(m.base, w.base); m.top = Math.max(m.top, w.top);
    m.strength = Math.max(m.strength, w.strength);
    m.c = [(m.c[0] + w.c[0]) / 2, (m.c[1] + w.c[1]) / 2];
  }).sort((a, b) => b.strength - a.strength).slice(0, max);
}
