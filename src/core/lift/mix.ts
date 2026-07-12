// ============ the lift potential: which components, and in what blend ============
// The lift potential is a blend of independent physical components — thermal, slope,
// convergence, wave. The user sets the blend with a simplex "mixer": a point on an axis for
// 2 components, in a triangle for 3, in a regular N-gon beyond, and the barycentric
// coordinates of that point ARE the weights.
//
// The geometry is the interesting part and it is pure: given the vertices of a convex
// polygon, a point inside maps to weights that sum to 1, and weights map back to a point.
// The SVG widget that draws it is not the kernel's business.

export interface LiftComp { key: string; ik: string; color: [number, number, number] }

// Mixer order = vertex order. Add an entry here (with its i18n label key and a renderer wired
// in the app) and the mixer grows a vertex automatically. `color` is the vertex swatch.
export const LIFT_COMPS: LiftComp[] = [
  { key: 'thermal', ik: 'liftThermal', color: [235, 140, 60] },
  { key: 'slope', ik: 'liftSlope', color: [150, 200, 90] },
  { key: 'converg', ik: 'liftConverg', color: [110, 190, 165] },
  { key: 'wave', ik: 'liftWave', color: [175, 140, 225] },
];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Normalised blend weight (0..1, Σ=1 across the ENABLED components) of one component.
 *  0 for an unknown key, a disabled component, or an empty mix. Robust to stored arrays of a
 *  different length — a setting saved by an older version pads rather than breaks. */
export function liftWeight(key: string, on: readonly boolean[], mix: readonly number[]): number {
  const i = LIFT_COMPS.findIndex(c => c.key === key);
  if (i < 0) return 0;
  if (on[i] === false) return 0;
  let sum = 0;
  for (let j = 0; j < LIFT_COMPS.length; j++) if (on[j] !== false) sum += Math.max(0, mix[j] || 0);
  return sum > 0 ? Math.max(0, mix[i] || 0) / sum : 0;
}

// ---- the simplex ----

/** Vertex positions for n enabled components: a single point, a horizontal segment, or a
 *  regular polygon with the first vertex at the top. */
export function simplexVerts(n: number, cx: number, cy: number, r: number): [number, number][] {
  if (n <= 1) return [[cx, cy]];
  if (n === 2) return [[cx - r, cy], [cx + r, cy]];
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

/** Generalised barycentric weights (Σ=1) of a point in the simplex: linear on a segment
 *  (n=2), mean-value coordinates (Floater) for a convex polygon (n≥3). */
export function weightsFromPoint(px: number, py: number, V: readonly [number, number][]): number[] {
  const n = V.length;
  if (n <= 1) return [1];
  if (n === 2) {
    const [ax, ay] = V[0], [bx, by] = V[1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const ti = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    return [1 - ti, ti];
  }
  const eps = 1e-6;
  const s = V.map(([vx, vy]) => [vx - px, vy - py] as [number, number]);
  const r = s.map(([x, y]) => Math.hypot(x, y));
  for (let i = 0; i < n; i++) if (r[i] < eps) { const w = new Array(n).fill(0); w[i] = 1; return w; }
  const tan = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = s[i][0] * s[j][1] - s[i][1] * s[j][0];
    const D = s[i][0] * s[j][0] + s[i][1] * s[j][1];
    tan[i] = Math.abs(A) < eps ? 0 : (r[i] * r[j] - D) / A;
  }
  const w = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { w[i] = Math.max(0, (tan[(i + n - 1) % n] + tan[i]) / r[i]); sum += w[i]; }
  return sum > 0 ? w.map(x => x / sum) : new Array(n).fill(1 / n);
}

/** Handle position from weights: the affine combination Σ wᵢ·Vᵢ — always inside. */
export function pointFromWeights(w: readonly number[], V: readonly [number, number][]): [number, number] {
  let x = 0, y = 0, s = 0;
  for (let i = 0; i < V.length; i++) { const wi = Math.max(0, w[i] || 0); x += wi * V[i][0]; y += wi * V[i][1]; s += wi; }
  return s > 0 ? [x / s, y / s] : [V[0] ? V[0][0] : 0, V[0] ? V[0][1] : 0];
}

/** Clamp a drag point into the simplex: inside → unchanged; outside → the nearest point on the
 *  boundary, so the handle stays on the edge you drag toward instead of the mean-value weights
 *  going negative and snapping it to the opposite vertex. Nudged a hair toward the centroid to
 *  keep the barycentric coordinates non-degenerate on the edges. */
export function clampToSimplex(px: number, py: number, V: readonly [number, number][]): [number, number] {
  const n = V.length;
  if (n <= 1) return [V[0][0], V[0][1]];
  const seg = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    return [ax + t * dx, ay + t * dy];
  };
  if (n === 2) return seg(V[0][0], V[0][1], V[1][0], V[1][1]);
  let pos = false, neg = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = (V[j][0] - V[i][0]) * (py - V[i][1]) - (V[j][1] - V[i][1]) * (px - V[i][0]);
    if (cr > 1e-6) pos = true; else if (cr < -1e-6) neg = true;
  }
  if (!(pos && neg)) return [px, py];   // inside: every cross-product has the same sign
  let best: [number, number] = [px, py], bd = Infinity;
  for (let i = 0; i < n; i++) {
    const q = seg(V[i][0], V[i][1], V[(i + 1) % n][0], V[(i + 1) % n][1]);
    const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  let cx = 0, cy = 0;
  for (const [vx, vy] of V) { cx += vx; cy += vy; }
  cx /= n; cy /= n;
  return [best[0] + 0.02 * (cx - best[0]), best[1] + 0.02 * (cy - best[1])];
}
