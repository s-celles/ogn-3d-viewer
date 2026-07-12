import { test, expect } from 'bun:test';
import { sampleDisc, type FieldGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

const G: FieldGrid = { cLon: 6, cLat: 45, R: 2000, step: 500 };
const mLng = mPerLng(G.cLat);

/** Metres east / north of the grid centre. */
const east = (lon: number) => (lon - G.cLon) * mLng;
const north = (lat: number) => (lat - G.cLat) * M_PER_LAT;

/** A tilted plane: elevation rises `gx` m/m eastward and `gy` m/m northward. */
const plane = (gx: number, gy: number, h0 = 1000): ElevSampler =>
  (lon, lat) => h0 + gx * east(lon) + gy * north(lat);

test('samples a disc, not the bounding square', () => {
  const { cells, sampled } = sampleDisc(G, plane(0, 0));
  expect(sampled).toBe(cells.length);
  // Every cell is inside the disc, and the corners of the square are not sampled.
  for (const c of cells) expect(Math.hypot(east(c.lon), north(c.lat))).toBeLessThanOrEqual(G.R + 1e-6);
  const corner = cells.some(c => east(c.lon) > 1900 && north(c.lat) > 1900);
  expect(corner).toBe(false);
  expect(cells.length).toBeGreaterThan(30);
});

test('recovers the terrain gradient of a plane exactly', () => {
  const { cells } = sampleDisc(G, plane(0.1, -0.05));
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells) {
    expect(c.gx).toBeCloseTo(0.1, 9);
    expect(c.gy).toBeCloseTo(-0.05, 9);
    expect(c.elev).toBeCloseTo(1000 + 0.1 * east(c.lon) - 0.05 * north(c.lat), 6);
  }
});

test('an unknown elevation drops the cell — it is never faked to zero', () => {
  const nothing: ElevSampler = () => null;
  const { cells, sampled } = sampleDisc(G, nothing);
  expect(cells).toEqual([]);
  expect(sampled).toBe(0);
});

test('a cell whose stencil is only partly known is dropped', () => {
  // Terrain known west of the centre only: cells needing an eastern neighbour drop out.
  const half: ElevSampler = (lon, lat) => (east(lon) <= 0 ? plane(0.1, 0)(lon, lat) : null);
  const { cells, sampled } = sampleDisc(G, half);
  expect(sampled).toBe(cells.length);
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells) expect(east(c.lon)).toBeLessThan(0);   // needs lon + step known too
});
