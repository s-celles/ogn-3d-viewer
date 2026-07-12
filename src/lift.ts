// ============ the lift-potential registry, bound to the app's state ============
// The component registry and the simplex maths live in core/lift/mix.ts. This is the thin
// binding that reads the user's blend out of S — the kernel takes the arrays as arguments,
// because a flight computer has no S.
import { S } from './state';
import { LIFT_COMPS, liftWeight as weightOf, type LiftComp } from './core/lift/mix';

export { LIFT_COMPS, type LiftComp };

/** Normalised blend weight (0..1) of one component, from the mixer vector in S. */
export const liftWeight = (key: string): number => weightOf(key, S.liftOn || [], S.liftMix || []);
