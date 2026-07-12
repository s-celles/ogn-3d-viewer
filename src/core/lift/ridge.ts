// ============ ridge / slope lift: a deterministic field from terrain × wind ============
// Unlike thermals (which we must detect from circling probes), slope lift is just wind
// deflected by the ground, so we can PREDICT it from the DEM and the wind — everywhere,
// with or without traffic. The terrain-forced vertical air velocity is
//   w = wind · ∇terrain            (positive where the wind blows uphill)
// refined by two effects: higher ground upwind shelters a cell (less lift in the lee),
// and on a sunny day the heated slopes drive an up-slope (anabatic) flow that lifts even
// when the synoptic wind is calm. Rough and illustrative (see docs) — but a *value*: no
// renderer, no app state, no network.
import { sampleDisc, medianCellElev, type FieldGrid, type TerrainCell } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler, WindProfile } from '../ports';

export const LU = 900;          // upwind probe distance for terrain sheltering (m)
export const H_SHELTER = 320;   // upwind terrain this much higher → wind ~fully sheltered (m)
export const W_MIN = 0.4;       // m/s: weakest slope lift / sink worth reporting
export const ANA_GAIN = 4.0;    // anabatic (thermal upslope) wind gain — sunny slopes lift on calm days
export const INSOL_REF = 0.25;  // sin(sun elevation) at which daytime heating saturates the anabatic wind
export const WIND_ALT = 400;    // m above the ground: the wind that works a slope, ~mid-ridge height
const CALM = 0.5;               // m/s: below this the wind has no direction worth sheltering from
const WIND_MIN = 1.5;           // m/s: below this, only the sun can make slope lift

export interface RidgeParams {
  /** Unit vector *towards* the sun in the local ENU frame; null (or below the horizon)
   *  → no anabatic contribution. Its z component is sin(sun elevation) = the insolation. */
  sun: [number, number, number] | null;
  lu?: number;
  hShelter?: number;
  wMin?: number;
  anaGain?: number;
}

/** A cell of ground with the vertical air velocity (m/s) over it. */
export interface LiftCell extends TerrainCell { w: number }

/** `wind` is the REFERENCE wind — the one over the typical ground in view, used for the gate and
 *  reported so a caller can key a cache on it. Each cell is computed with the wind at ITS OWN
 *  height, which is not this one. */
export interface ScalarField { grid: FieldGrid; cells: LiftCell[]; sampled: number; wind: [number, number] }

/** Daytime heating, 0..1: sin(sun elevation), saturating at INSOL_REF. 0 at night. */
export function insolation(sun: readonly [number, number, number] | null): number {
  if (!sun || !Number.isFinite(sun[2])) return 0;
  return Math.max(0, Math.min(1, sun[2] / INSOL_REF));
}

/** Can there be slope lift here at all? Calm *and* dark means no: nothing to deflect and
 *  nothing to heat. Cheap enough to ask before doing any terrain work. */
export function ridgeActive(wind: readonly [number, number], sun: readonly [number, number, number] | null): boolean {
  return Math.hypot(wind[0], wind[1]) >= WIND_MIN || insolation(sun) > 0;
}

export function ridgeField(
  g: FieldGrid, elev: ElevSampler, wind: WindProfile, p: RidgeParams,
): ScalarField {
  const lu = p.lu ?? LU, hShelter = p.hShelter ?? H_SHELTER;
  const wMin = p.wMin ?? W_MIN, anaGain = p.anaGain ?? ANA_GAIN;
  const su = p.sun;
  const insol = insolation(su);
  const mLng = mPerLng(g.cLat), mLat = M_PER_LAT;
  const { cells: ground, sampled } = sampleDisc(g, elev);

  // The reference wind: the one over the TYPICAL ground in view (the median of what loaded),
  // not over whatever pixel the camera happens to sit on. It decides whether there is a field
  // at all; each cell then gets the wind at its own height.
  const refElev = medianCellElev(ground) ?? 0;
  const refWind = wind(refElev + WIND_ALT) ?? [0, 0];
  if (!ridgeActive(refWind, su)) return { grid: g, cells: [], sampled: 0, wind: [refWind[0], refWind[1]] };

  const cells: LiftCell[] = [];
  for (const c of ground) {
    // The wind at THIS cell's height. A crest at 1600 m stands in a different wind from the
    // valley floor below it — on a windy day, twice the speed, and it can have veered 60° on
    // the way up. Using one wind for the whole scene threw that away.
    const wc = wind(c.elev + WIND_ALT) ?? refWind;
    const s0 = Math.hypot(wc[0], wc[1]);
    const calm = s0 < CALM;
    const upE = calm ? 0 : -wc[0] / s0, upN = calm ? 0 : -wc[1] / s0;   // upwind unit, for terrain sheltering
    // Refine the wind with the terrain: higher ground upwind shelters this cell (less lift in
    // the lee); an exposed windward crest keeps or boosts it.
    const hUp = calm ? null : elev(c.lon + upE * lu / mLng, c.lat + upN * lu / mLat);
    const scale = hUp == null ? 1 : Math.max(0.2, Math.min(1.4, 1 - (hUp - c.elev) / hShelter));
    // Anabatic upslope contribution: heated (sun-facing) slopes lift, ∝ insolation × sun
    // incidence × slope — added to the synoptic wind·∇terrain (uphill = lift).
    const slope = Math.hypot(c.gx, c.gy), nl = Math.hypot(c.gx, c.gy, 1);
    const cosInc = insol > 0 && su ? Math.max(0, (su[0] * -c.gx + su[1] * -c.gy + su[2]) / nl) : 0;
    const w = (wc[0] * c.gx + wc[1] * c.gy) * scale + anaGain * insol * cosInc * slope;
    if (Math.abs(w) < wMin) continue;   // near-flat / cross-wind
    cells.push({ ...c, w });
  }
  return { grid: g, cells, sampled, wind: [refWind[0], refWind[1]] };
}
