// ============ lift-potential components + their mixer weights ============
// The lift potential is a blend of independent physical components — thermal, slope,
// and (later) wave. The user sets the blend with a simplex "mixer": a point on an
// axis for 2 components, in a triangle for 3, in a regular N-gon beyond. This module
// owns the component registry and the per-component weight lookup; liftmixer.ts owns
// the widget and the point↔weights geometry.
import { S } from './state';

export interface LiftComp { key: string; ik: string; color: [number, number, number] }

// Mixer order = vertex order. Add a 'wave' entry here (with its i18n label key and a
// renderer wired in render.ts) and the mixer grows a vertex automatically. `color` is
// the vertex swatch, a hint at the component's identity.
export const LIFT_COMPS: LiftComp[] = [
  { key: 'thermal', ik: 'liftThermal', color: [235, 140, 60] },
  { key: 'slope', ik: 'liftSlope', color: [150, 200, 90] },
  { key: 'converg', ik: 'liftConverg', color: [110, 190, 165] },
];

/** Normalised blend weight (0..1, Σ=1 across components) of one component, from the
 *  mixer vector S.liftMix (same order as LIFT_COMPS). 0 for an unknown key or an
 *  empty mix. Robust to a stored mix of a different length (missing → 0). */
export function liftWeight(key: string): number {
  const i = LIFT_COMPS.findIndex(c => c.key === key);
  if (i < 0) return 0;
  const m = S.liftMix || [];
  let sum = 0;
  for (let j = 0; j < LIFT_COMPS.length; j++) sum += Math.max(0, m[j] || 0);
  return sum > 0 ? Math.max(0, m[i] || 0) / sum : 0;
}
