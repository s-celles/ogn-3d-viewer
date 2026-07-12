// ============ the sampling grid of a lift field ============
// Every lift component (slope, convergence, wave) starts the same way: a disc of cells
// around a centre, each carrying the ground height and the terrain gradient under it.
// That stencil is the shared primitive; what each component then does with (h, ∇h) is
// its own physics.
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

/** A disc of radius `R` metres around (cLon, cLat), sampled every `step` metres. */
export interface FieldGrid { cLon: number; cLat: number; R: number; step: number }

/** The ground at one cell: its height (m AMSL) and the terrain gradient (m/m). */
export interface TerrainCell { lon: number; lat: number; elev: number; gx: number; gy: number }

/** `sampled` is how many cells the elevation sampler could actually answer for. An
 *  empty `cells` with `sampled === 0` means "the ground is not loaded here", which is
 *  a different fact from "the ground here is flat" — callers cache on one, not the other. */
export interface DiscSample { cells: TerrainCell[]; sampled: number }

/** An n×n lattice of nodes spanning 2R metres around (cLon, cLat). Unlike the disc, the
 *  nodes are *indexed*: a field that needs neighbours — a divergence, a curvature, a blur
 *  — can only be computed on a lattice. */
export interface NodeGrid { cLon: number; cLat: number; R: number; n: number }

/** The ground on a lattice, as parallel arrays indexed j * n + i (i east, j north).
 *  `ok` marks the nodes whose stencil was fully known; `ready` counts them. */
export interface TerrainNodes {
  n: number; sp: number;
  lon: Float64Array; lat: Float64Array;          // node coordinates, by i and by j
  h: Float32Array; gx: Float32Array; gy: Float32Array;
  ok: Uint8Array; ready: number;
}

/** Node spacing (m) of a lattice. */
export const nodeStep = (g: NodeGrid): number => 2 * g.R / (g.n - 1);

/** Where the nodes are, without touching the ground: lon by i, lat by j. */
export function nodeCoords(g: NodeGrid): { lon: Float64Array; lat: Float64Array; sp: number } {
  const { cLon, cLat, R, n } = g;
  const sp = nodeStep(g), mLng = mPerLng(cLat), mLat = M_PER_LAT;
  const lon = new Float64Array(n), lat = new Float64Array(n);
  for (let i = 0; i < n; i++) { lon[i] = cLon + (-R + i * sp) / mLng; lat[i] = cLat + (-R + i * sp) / mLat; }
  return { lon, lat, sp };
}

/** Sample the ground on the lattice. `baseline` is the half-width of the gradient stencil
 *  in metres — deliberately independent of the node spacing, so the gradient stays a
 *  property of the terrain rather than of the grid resolution. */
export function sampleNodes(g: NodeGrid, elev: ElevSampler, baseline: number): TerrainNodes {
  const { cLat, n } = g;
  const { lon, lat, sp } = nodeCoords(g);
  const mLng = mPerLng(cLat), mLat = M_PER_LAT;

  const h = new Float32Array(n * n), gx = new Float32Array(n * n), gy = new Float32Array(n * n);
  const ok = new Uint8Array(n * n);
  let ready = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const lo = lon[i], la = lat[j], idx = j * n + i;
    const hC = elev(lo, la);
    const hE = elev(lo + baseline / mLng, la), hW = elev(lo - baseline / mLng, la);
    const hN = elev(lo, la + baseline / mLat), hS = elev(lo, la - baseline / mLat);
    if (hC == null || hE == null || hW == null || hN == null || hS == null) continue;
    h[idx] = hC;
    gx[idx] = (hE - hW) / (2 * baseline);
    gy[idx] = (hN - hS) / (2 * baseline);
    ok[idx] = 1; ready++;
  }
  return { n, sp, lon, lat, h, gx, gy, ok, ready };
}

/** The typical ground of a lattice: the median height of the nodes whose terrain is known.
 *  A MEDIAN, not the height at some chosen point — one point is a coin toss (a lake or the
 *  peak beside it) and it is not even loaded half the time. Null when nothing is loaded. */
export function medianElev(t: TerrainNodes): number | null {
  const hs: number[] = [];
  for (let i = 0; i < t.ok.length; i++) if (t.ok[i]) hs.push(t.h[i]);
  if (!hs.length) return null;
  hs.sort((a, b) => a - b);
  return hs[hs.length >> 1];
}

/** Separable box blur (radius r) of an n×n field — edges shrink the window, they do not wrap. */
export function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let d = -r; d <= r; d++) { const ii = i + d; if (ii < 0 || ii >= n) continue; s += src[j * n + ii]; c++; }
    tmp[j * n + i] = s / c;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let d = -r; d <= r; d++) { const jj = j + d; if (jj < 0 || jj >= n) continue; s += tmp[jj * n + i]; c++; }
    out[j * n + i] = s / c;
  }
  return out;
}

/** Sample the ground over the disc, taking the gradient from a 5-point stencil of
 *  width `step`. A cell whose stencil is not fully known is dropped, never guessed. */
export function sampleDisc(g: FieldGrid, elev: ElevSampler): DiscSample {
  const { cLon, cLat, R, step } = g;
  const mLng = mPerLng(cLat), mLat = M_PER_LAT;
  const cells: TerrainCell[] = [];
  let sampled = 0;
  for (let y = -R; y <= R; y += step) for (let x = -R; x <= R; x += step) {
    if (x * x + y * y > R * R) continue;
    const lon = cLon + x / mLng, lat = cLat + y / mLat;
    const hC = elev(lon, lat); if (hC == null) continue;
    const hE = elev(lon + step / mLng, lat), hW = elev(lon - step / mLng, lat);
    const hN = elev(lon, lat + step / mLat), hS = elev(lon, lat - step / mLat);
    if (hE == null || hW == null || hN == null || hS == null) continue;
    sampled++;
    cells.push({ lon, lat, elev: hC, gx: (hE - hW) / (2 * step), gy: (hN - hS) / (2 * step) });
  }
  return { cells, sampled };
}
