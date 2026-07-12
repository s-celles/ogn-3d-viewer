// ============ reading the air off a glider's track ============
// A glider is an atmospheric probe. Both air-mass detectors — thermals (circling climbs)
// and wave (straight sustained climbs) — do the same three things before they differ:
// resample the track at a fixed step, give every sample a SMOOTHED heading (a raw beacon
// heading is noise), and group the samples that satisfy some predicate into runs, bridging
// brief interruptions so one continuous climb stays one climb instead of shattering.
//
// Only the predicate and what is made of a run differ. That is what lives here.
import { bearingDeg, distM } from './geo';
import type { Probe } from './ports';

/** One resampled point of a track, with a heading smoothed over a ±window baseline. */
export interface Samp { t: number; lon: number; lat: number; alt: number; hdg: number }

/** Resample a probe every `step` seconds and give each sample a heading taken over a ±`hw`
 *  second baseline — long enough to ride over sparse, jittery beacons. */
export function sampleProbe(p: Probe, step: number, hw: number): Samp[] {
  const s: Samp[] = [];
  for (let t = p.rstart; t <= p.rend; t += step) {
    const q = p.at(t);
    s.push({ t, lon: q[0], lat: q[1], alt: q[2], hdg: 0 });
  }
  for (const smp of s) {
    const a = p.at(Math.max(p.rstart, smp.t - hw)), b = p.at(Math.min(p.rend, smp.t + hw));
    smp.hdg = bearingDeg(a[0], a[1], b[0], b[1]);
  }
  return s;
}

/** Signed heading change (deg, −180..180) — the short way round, so a turn through north
 *  reads as a few degrees and not as 359. */
export const turnDelta = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

/** Net heading swept over a run (deg, signed): ≥360 is a full circle. */
export function netTurn(run: Samp[]): number {
  let net = 0;
  for (let i = 1; i < run.length; i++) net += turnDelta(run[i - 1].hdg, run[i].hdg);
  return net;
}

/** Turn rate (deg/s) and climb rate (m/s) around sample i, over a ±`g`-sample baseline. */
export function rates(s: Samp[], i: number, g: number, step: number): { turn: number; climb: number } {
  const a = s[Math.max(0, i - g)], b = s[Math.min(s.length - 1, i + g)];
  const span = 2 * g * step;
  return { turn: Math.abs(turnDelta(a.hdg, b.hdg)) / span, climb: (b.alt - a.alt) / span };
}

/** Index ranges [from, to] of the runs where `flag` holds, bridging gaps of up to `gap`
 *  seconds. A climb that briefly stops satisfying the predicate is still one climb. */
export function runs(flag: boolean[], step: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  const n = flag.length;
  let i = 0;
  while (i < n) {
    if (!flag[i]) { i++; continue; }
    let last = i, g = 0, k = i + 1;
    while (k < n) {
      if (flag[k]) { last = k; g = 0; }
      else if ((g += step) > gap) break;
      k++;
    }
    out.push([i, last]);
    i = last + 1;
  }
  return out;
}

/** Merge the climbs that are really the same air seen by different gliders: overlapping in
 *  time (with a minute's slack) and closer than `withinM` on the ground. `combine` decides
 *  what the merged climb keeps. */
export function mergeClimbs<T extends { t0: number; t1: number }>(
  list: T[], centre: (x: T) => [number, number], withinM: number, combine: (into: T, from: T) => void,
): T[] {
  const merged: T[] = [];
  for (const c of list.slice().sort((a, b) => a.t0 - b.t0)) {
    const m = merged.find(x => {
      if (!(x.t0 <= c.t1 + 60 && c.t0 <= x.t1 + 60)) return false;
      const [xl, xt] = centre(x), [cl, ct] = centre(c);
      return distM(xl, xt, cl, ct) < withinM;
    });
    if (!m) { merged.push({ ...c }); continue; }
    combine(m, c);
  }
  return merged;
}
