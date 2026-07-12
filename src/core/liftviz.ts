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
