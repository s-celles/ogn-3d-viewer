// The slope-lift field is deterministic physics: wind deflected by the ground. These
// tests pin it to analytic terrain (tilted planes), where w = wind·∇terrain is known
// in closed form — so a refactor that quietly changes the physics fails here, not in
// a pilot's briefing. No app state, no DEM tiles, no renderer.
import { test, expect } from 'bun:test';
import { ridgeField } from './ridge';
import type { FieldGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

const G: FieldGrid = { cLon: 6, cLat: 45, R: 2000, step: 500 };
const mLng = mPerLng(G.cLat);
const east = (lon: number) => (lon - G.cLon) * mLng;
const north = (lat: number) => (lat - G.cLat) * M_PER_LAT;

const plane = (gx: number, gy: number, h0 = 1000): ElevSampler =>
  (lon, lat) => h0 + gx * east(lon) + gy * north(lat);

const ZENITH: [number, number, number] = [0, 0, 1];   // unit vector towards the sun, overhead
/** No upwind probe (lu = 0) → the sheltering factor is exactly 1: isolates wind·∇terrain. */
const bare = { sun: null, lu: 0 } as const;

test('flat ground makes no lift, however hard the wind blows', () => {
  const f = ridgeField(G, plane(0, 0), [15, 0], bare);
  expect(f.cells).toEqual([]);
  expect(f.sampled).toBeGreaterThan(0);   // the terrain IS loaded — there is simply nothing to deflect
});

test('wind straight up a 10% slope lifts at w = |wind| × slope', () => {
  const f = ridgeField(G, plane(0.1, 0), [10, 0], bare);
  expect(f.cells.length).toBeGreaterThan(30);
  for (const c of f.cells) expect(c.w).toBeCloseTo(1.0, 9);   // 10 m/s × 0.1
});

test('the same slope with the wind reversed sinks, symmetrically', () => {
  const f = ridgeField(G, plane(0.1, 0), [-10, 0], bare);
  expect(f.cells.length).toBeGreaterThan(30);
  for (const c of f.cells) expect(c.w).toBeCloseTo(-1.0, 9);
});

test('a cross-wind over a slope neither lifts nor sinks', () => {
  const f = ridgeField(G, plane(0.1, 0), [0, 10], bare);   // slope faces east, wind blows north
  expect(f.cells).toEqual([]);
  expect(f.sampled).toBeGreaterThan(0);
});

test('each cell carries the terrain it was computed on, so it can be drawn on the slope', () => {
  const f = ridgeField(G, plane(0.1, 0), [10, 0], bare);
  const c = f.cells[0];
  expect(c.gx).toBeCloseTo(0.1, 9);
  expect(c.gy).toBeCloseTo(0, 9);
  expect(c.elev).toBeCloseTo(1000 + 0.1 * east(c.lon), 6);
});

// ---- terrain sheltering: higher ground upwind steals the wind ----

test('higher ground upwind weakens the lift; an exposed windward face strengthens it', () => {
  // Plane rising 0.1 m/m eastward. Wind from the east (blowing west) descends it: the
  // upwind probe, 900 m to windward (east), sits 90 m higher → scale = 1 − 90/320.
  const lee = ridgeField(G, plane(0.1, 0), [-10, 0], { sun: null });
  for (const c of lee.cells) expect(c.w).toBeCloseTo(-1.0 * (1 - 90 / 320), 6);
  // Wind from the west climbs it: the upwind ground is 90 m *lower* → scale = 1 + 90/320.
  const luv = ridgeField(G, plane(0.1, 0), [10, 0], { sun: null });
  for (const c of luv.cells) expect(c.w).toBeCloseTo(1.0 * (1 + 90 / 320), 6);
});

test('sheltering is clamped: never below 0.2, never above 1.4', () => {
  // hShelter = 50 m makes the 90 m upwind step overwhelming in both directions.
  const p = { sun: null, hShelter: 50, wMin: 0.1 };
  const lee = ridgeField(G, plane(0.1, 0), [-10, 0], p);   // 1 − 90/50 = −0.8 → floored at 0.2
  for (const c of lee.cells) expect(c.w).toBeCloseTo(-0.2, 6);
  const luv = ridgeField(G, plane(0.1, 0), [10, 0], p);    // 1 + 90/50 = 2.8 → capped at 1.4
  for (const c of luv.cells) expect(c.w).toBeCloseTo(1.4, 6);
});

// ---- anabatic: sunny slopes lift on a calm day ----

test('a sunny slope lifts with no wind at all, and more steeply the steeper it is', () => {
  const gentle = ridgeField(G, plane(0.2, 0), [0, 0], { sun: ZENITH });
  const steep = ridgeField(G, plane(0.4, 0), [0, 0], { sun: ZENITH });
  expect(gentle.cells.length).toBeGreaterThan(30);
  // ANA_GAIN × insolation × cos(incidence) × slope, with the sun overhead: 4 × 1 × (1/|n|) × s
  for (const c of gentle.cells) expect(c.w).toBeCloseTo(4 * (1 / Math.hypot(0.2, 1)) * 0.2, 6);
  for (const c of steep.cells) expect(c.w).toBeCloseTo(4 * (1 / Math.hypot(0.4, 1)) * 0.4, 6);
  expect(steep.cells[0].w).toBeGreaterThan(gentle.cells[0].w);
});

test('calm night: no wind and no sun means no field at all', () => {
  const f = ridgeField(G, plane(0.3, 0), [0.2, 0], { sun: null });
  expect(f.cells).toEqual([]);
});

// ---- the field must say "I could not look", not "there is nothing here" ----

test('unloaded terrain reports zero samples, so the caller knows not to trust the emptiness', () => {
  const f = ridgeField(G, () => null, [10, 0], bare);
  expect(f.cells).toEqual([]);
  expect(f.sampled).toBe(0);
});
