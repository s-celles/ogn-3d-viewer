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
