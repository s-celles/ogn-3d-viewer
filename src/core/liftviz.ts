// ============ shared lift colour ramp ============
// One colour language for vertical air motion, used by the thermal potential, the
// slope lift and the combined lift-potential field: warm = it climbs (updraft),
// cool = it sinks (leeward descent). So lift reads the same whatever its source.
// RGBA; alpha ramps up with strength.
export const LIFT_COLORS: [number, number, number, number][] = [
  [150, 200, 90, 45], [210, 205, 80, 66], [235, 170, 60, 92], [235, 115, 55, 116], [225, 70, 60, 142],
];
export const SINK_COLORS: [number, number, number, number][] = [
  [120, 165, 215, 40], [85, 120, 205, 64], [60, 85, 185, 92],
];

// Vertical air motion binned into six strength classes — 3 of lift, then 3 of sink —
// so a field of w values becomes a handful of drawable strata (one mesh, one colour
// each) instead of a per-cell colour. Same bins whatever the renderer.
export const BIN_COLORS: [number, number, number, number][] = [
  LIFT_COLORS[0], LIFT_COLORS[2], LIFT_COLORS[4], ...SINK_COLORS,
];

/** Bin index (0..2 rising, 3..5 sinking) of a signed field value, by |v| against two
 *  ascending thresholds. The thresholds are the field's own — vertical velocities are
 *  binned in m/s, a normalised convergence in its own dimensionless units — but the six
 *  strata, and their colours, are shared. */
export function strataBin(v: number, t: readonly [number, number]): number {
  const av = Math.abs(v), lvl = av >= t[1] ? 2 : av >= t[0] ? 1 : 0;
  return v > 0 ? lvl : 3 + lvl;
}

/** Bin index of a vertical velocity (m/s), by |w|: <1, <2, ≥2. */
export const liftBin = (w: number): number => strataBin(w, [1, 2]);

// An elevated streamline sheet is read differently from a draped patch: it is a continuous
// surface, so the band where the flow is level must still be drawn — faintly — or the sheet
// would have holes in it. Hence a signed five-band ramp with a neutral middle, ordered
// strong-up → mild-up → level → mild-down → strong-down.
const NEUTRAL: [number, number, number, number] = [175, 205, 235, 30];   // faint band where the flow is level
export const SHEET_COLORS: [number, number, number, number][] = [
  LIFT_COLORS[4], LIFT_COLORS[2], NEUTRAL, SINK_COLORS[1], SINK_COLORS[0],
];
export const W_LO = 0.4, W_HI = 1.2;   // m/s: neutral / mild / strong colouring

/** Band index (0 strong up … 2 level … 4 strong down) of a streamline's vertical velocity. */
export function sheetBand(w: number, lo = W_LO, hi = W_HI): number {
  return w >= hi ? 0 : w >= lo ? 1 : w > -lo ? 2 : w > -hi ? 3 : 4;
}

// The thermal map shows an ANOMALY: how far each patch of ground beats, or falls short of, the
// flat reference ground under the same sun. Warm above, blue below, one continuous scale
// through zero.
//
// It used to try to be two things at once — warm keyed on the ABSOLUTE updraught (against a
// fixed W_FULL of 1.5 m/s) but *selected* by a relative test (vz >= wRef). Those fight:
//   - On a good day the reference itself lands at 0.95 · W_FULL, so every cell that beats it is
//     instantly full red. The four intermediate warm shades became unreachable, and the map
//     came out red-or-nothing. Any small ripple in the field — a cloud street's ±15% — flipped
//     cells across that cliff, so flat ground was painted in stripes.
//   - Worse, liftCalibration multiplies the whole field by up to 3.5 to match the day's real
//     climbs. An absolute scale cannot survive its own calibration: calibrate a good day and
//     everything goes past W_FULL. The anomaly is INVARIANT under it — cal scales vz and wRef
//     alike — which is what settles the argument.
// The cost is honest: the legend can no longer read absolute m/s.
export const THERMAL_COLORS: [number, number, number, number][] = [...LIFT_COLORS, ...SINK_COLORS];

// Thresholds on the fractional anomaly (vz − wRef) / scaleRef, set from the distribution the
// model actually produces over real terrain: the excess tops out near +30%, so red means
// "exceptional ground", not "an ordinary sunny slope".
const WARM_MIN = 0.04;                      // below this a cell is unremarkable — leave the ground clean
const WARM_FRAC = [0.08, 0.13, 0.19, 0.26]; // 5 warm shades, red ≥ the last
const SINK_MIN = 0.20;                      // a real deficit: shaded and poorly-exposed faces
const SINK_FRAC = [0.30, 0.42];             // 3 blue shades

/** Colour index (0-4 warm by excess, 5-7 blue by deficit) of an updraught against the flat
 *  reference `wRef`. Null in the middle — the unremarkable ground, which is most of a map. */
export function thermalBin(vz: number, wRef: number, scaleRef: number): number | null {
  const a = (vz - wRef) / scaleRef;
  if (a >= WARM_MIN) {
    let bin = 0;
    while (bin < WARM_FRAC.length && a >= WARM_FRAC[bin]) bin++;
    return bin;
  }
  if (-a < SINK_MIN) return null;
  let bin = LIFT_COLORS.length;
  while (bin - LIFT_COLORS.length < SINK_FRAC.length && -a >= SINK_FRAC[bin - LIFT_COLORS.length]) bin++;
  return bin;
}
