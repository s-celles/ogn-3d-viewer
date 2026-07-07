// ============ glider polar + netto vario ============
// A glider's still-air sink rate vs airspeed is a parabola through the three (speed,
// sink) points of its polar. From it we get the NETTO vario — the vertical velocity of
// the air mass — by removing the glider's own sink from the (total-energy) climb:
//     netto = Vz,TE − sink_polar(V)      (sink_polar < 0, so netto = Vz,TE + |sink|)
// Polars can be imported as XCSoar/LK8000 `.plr` files. A rough diagnostic: OGN gives no
// airspeed, so we substitute GPS ground speed (biased by wind/turns) — see the docs.
// The reference glider (ASK 21) ships as a bundled `.plr` under data/polars/, parsed here
// through the very same path a user import takes.
import ask21Plr from '../data/polars/ASK 21.plr' with { type: 'text' };

export interface Polar { name: string; a: number; b: number; c: number; vMin: number; vMax: number }

const VMIN = 15, VMAX = 60;   // m/s: clamp airspeed to the polar's sensible range (~54–216 km/h)

// Fit y = a·x² + b·x + c through three points.
function fit3(p: [number, number][]): { a: number; b: number; c: number } {
  const [[x1, y1], [x2, y2], [x3, y3]] = p;
  const a = ((y3 - y2) / (x3 - x2) - (y2 - y1) / (x2 - x1)) / (x3 - x1);
  const b = (y2 - y1) / (x2 - x1) - a * (x1 + x2);
  return { a, b, c: y1 - a * x1 * x1 - b * x1 };
}
// Build a polar from three (speed km/h, sink m/s ≤ 0) points.
function make(name: string, pts: [number, number][]): Polar {
  const ms = pts.map(([v, s]) => [v / 3.6, s > 0 ? -s : s] as [number, number]);
  return { name, ...fit3(ms), vMin: VMIN, vMax: VMAX };
}

/** The reference glider (ASK 21), from the bundled data/polars/ASK 21.plr. */
export const DEFAULT_POLAR: Polar =
  parsePlr(ask21Plr, 'ASK 21') ?? make('ASK 21', [[100, -0.82], [120, -1.10], [150, -1.9]]);

/** Still-air sink (m/s, negative) at true airspeed V (m/s), clamped to the polar's range. */
export function sinkAt(pl: Polar, vMs: number): number {
  const v = Math.max(pl.vMin, Math.min(pl.vMax, vMs));
  return pl.a * v * v + pl.b * v + pl.c;
}
/** Netto (air vertical velocity, m/s): the total-energy climb minus the glider's own sink. */
export function nettoAt(pl: Polar, teVario: number, vMs: number): number {
  return teVario - sinkAt(pl, vMs);
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
