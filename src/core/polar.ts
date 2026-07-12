// ============ glider polar + netto vario ============
// A glider's still-air sink rate follows the physical two-term polar
//     w(V) = A·V³ + B/V          (parasitic drag ∝ V³, induced drag ∝ 1/V)
// obtained from the drag power balance W·w = D·V. We least-squares fit A and B to the
// three (speed, sink) points of the polar. From it we get the NETTO vario — the vertical
// velocity of the air mass — by removing the glider's own sink from the (total-energy) climb:
//     netto = Vz,TE − sink_polar(V)      (sink_polar < 0, so netto = Vz,TE + |sink|)
// Polars can be imported as XCSoar/LK8000 `.plr` files. A rough diagnostic: OGN gives no
// airspeed, so we substitute GPS ground speed (biased by wind/turns) — see the docs.
// The reference glider (ASK 21) ships as a bundled `.plr` under data/polars/, parsed here
// through the very same path a user import takes.
import ask21Plr from '../../data/polars/ASK 21.plr' with { type: 'text' };

export interface Polar { name: string; A: number; B: number; vMin: number; vMax: number }

const VMIN = 15, VMAX = 60;   // m/s: clamp airspeed to the polar's sensible range (~54–216 km/h)

// Least-squares fit of  w = A·x + B·y  with x = V³, y = 1/V, over the (V, sink) points.
function fit(pts: [number, number][]): { A: number; B: number } {
  let sxx = 0, sxy = 0, syy = 0, sxw = 0, syw = 0;
  for (const [v, w] of pts) {
    const x = v * v * v, y = 1 / v;
    sxx += x * x; sxy += x * y; syy += y * y; sxw += x * w; syw += y * w;
  }
  const det = sxx * syy - sxy * sxy;
  if (!det) return { A: 0, B: 0 };
  return { A: (sxw * syy - syw * sxy) / det, B: (sxx * syw - sxy * sxw) / det };
}
// Build a polar from three (speed km/h, sink m/s ≤ 0) points.
function make(name: string, pts: [number, number][]): Polar {
  const ms = pts.map(([v, s]) => [v / 3.6, s > 0 ? -s : s] as [number, number]);
  return { name, ...fit(ms), vMin: VMIN, vMax: VMAX };
}

/** The reference glider (ASK 21), from the bundled data/polars/ASK 21.plr. */
export const DEFAULT_POLAR: Polar =
  parsePlr(ask21Plr, 'ASK 21') ?? make('ASK 21', [[100, -0.82], [120, -1.10], [150, -1.9]]);

/** Still-air sink (m/s, negative) at true airspeed V (m/s), clamped to the polar's range. */
export function sinkAt(pl: Polar, vMs: number): number {
  const v = Math.max(pl.vMin, Math.min(pl.vMax, vMs));
  return pl.A * v * v * v + pl.B / v;
}
/** Netto (air vertical velocity, m/s): the total-energy climb minus the glider's own sink. */
export function nettoAt(pl: Polar, teVario: number, vMs: number): number {
  return teVario - sinkAt(pl, vMs);
}

/** The glider's minimum sink (m/s, negative) — its sink at the min-sink (circling) speed,
 *  the vertex of A·V³ + B/V at V = (B/3A)^¼. Used for the super/relative netto. */
export function minSink(pl: Polar): number {
  const r = pl.B / (3 * pl.A);
  let v = Number.isFinite(r) && r > 0 ? Math.pow(r, 0.25) : NaN;
  if (!Number.isFinite(v)) {   // degenerate fit: scan for the least-negative sink
    let best = -Infinity;
    for (let x = pl.vMin; x <= pl.vMax; x += 1) { const s = pl.A * x * x * x + pl.B / x; if (s > best) { best = s; v = x; } }
  }
  return sinkAt(pl, v);
}
/** Super (relative) netto (m/s): the climb the glider would get circling in this air —
 *  the netto reduced by the glider's own minimum (circling) sink. */
export function superNettoAt(pl: Polar, teVario: number, vMs: number): number {
  return nettoAt(pl, teVario, vMs) + minSink(pl);   // minSink < 0 → subtracts the circling sink
}

/** Parse an XCSoar/LK8000 `.plr` polar: a line
 *  `MassDryGross, MaxWaterBallast, Speed1, Sink1, Speed2, Sink2, Speed3, Sink3, WingArea`
 *  (comment lines start with `*`). Returns null if no usable line is found. */
export function parsePlr(text: string, name: string): Polar | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith('#') || line.startsWith(';')) continue;
    const n = line.split(',').map(s => parseFloat(s.trim()));
    if (n.length < 8 || n.slice(2, 8).some(x => !Number.isFinite(x))) continue;
    return make(name, [[n[2], n[3]], [n[4], n[5]], [n[6], n[7]]]);
  }
  return null;
}
