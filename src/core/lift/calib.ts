// ============ grounding the predicted lift in the day's real climbs ============
// The thermal field has an absolute scale that is only a guess. But the day's tracks give us
// REAL climb rates (core/airmass detects them). So: predict Vz at each detected thermal's
// place and time with the same physics, take the robust ratio observed/predicted, and rescale
// the field by it. The prediction is then grounded in what actually happened.
//
// A single global factor, not a spatial assimilation: it changes how strong the day READS,
// not the pattern. And a median, not a mean — one phantom climb must not move it.
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

const G = 9.81, THETA = 290, RHOCP = 1200;   // gravity, ref pot. temp (K), ρ·cp (J/m³K)
export const ALBEDO = 0.2, BETA = 0.35, GRAD = 80;   // uniform surface — a magnitude match, not a map
export const MIN_RATIOS = 4;                 // fewer observed climbs than this and we do not presume
export const CAL_MIN = 0.4, CAL_MAX = 3.5;   // the factor is clamped: a wild ratio is a bad detection
export const PRED_MIN = 0.25;                // m/s: a prediction weaker than this makes a useless ratio

export interface Radiation { dni: number; diff: number; convTop: number; ziFallback: number }

/** Predicted updraught Vz (m/s) at a point, with the thermal.ts physics but uniform land cover
 *  and no cast shadows — a point estimate, only ever used as the denominator of a ratio. Null
 *  when the ground is unknown, the sun is down, or the point is above the boundary layer. */
export function predictVzAt(
  lon: number, lat: number, elev: ElevSampler, sun: readonly [number, number, number], r: Radiation,
): number | null {
  const h = elev(lon, lat); if (h == null) return null;
  const mLng = mPerLng(lat), mLat = M_PER_LAT;
  const hE = elev(lon + GRAD / mLng, lat), hW = elev(lon - GRAD / mLng, lat);
  const hN = elev(lon, lat + GRAD / mLat), hS = elev(lon, lat - GRAD / mLat);
  if (hE == null || hW == null || hN == null || hS == null) return null;
  if (sun[2] <= 0.02) return null;
  const gx = (hE - hW) / (2 * GRAD), gy = (hN - hS) / (2 * GRAD);
  const zi = Math.max(0, Math.min(3500, Number.isFinite(r.convTop) ? r.convTop - h : r.ziFallback));
  if (zi < 100) return null;
  const nl = Math.hypot(gx, gy, 1);
  const cosInc = Math.max(0, (sun[0] * -gx + sun[1] * -gy + sun[2]) / nl);
  const H = (r.dni * cosInc + r.diff) * (1 - ALBEDO) * BETA;
  return 0.6 * Math.cbrt((G / THETA) * (H / RHOCP) * zi);
}

/** The day-scale calibration factor: the median of (observed climb / predicted Vz), clamped.
 *  1 when too few climbs were observed to presume anything — a refusal to guess, not a guess
 *  of 1. Predictions too weak to divide by are dropped rather than allowed to explode. */
export function calibrationFactor(pairs: readonly { observed: number; predicted: number | null }[]): number {
  const ratios: number[] = [];
  for (const p of pairs) if (p.predicted != null && p.predicted > PRED_MIN) ratios.push(p.observed / p.predicted);
  if (ratios.length < MIN_RATIOS) return 1;
  ratios.sort((a, b) => a - b);
  return Math.max(CAL_MIN, Math.min(CAL_MAX, ratios[Math.floor(ratios.length / 2)]));
}
