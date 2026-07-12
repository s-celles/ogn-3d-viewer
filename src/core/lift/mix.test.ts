import { test, expect } from 'bun:test';
import {
  LIFT_COMPS, liftWeight, simplexVerts, weightsFromPoint, pointFromWeights, clampToSimplex,
} from './mix';
import { calibrationFactor, predictVzAt, CAL_MIN, CAL_MAX } from './calib';
import type { ElevSampler } from '../ports';

const ON = LIFT_COMPS.map(() => true);

test('the blend weights are normalised across the ENABLED components', () => {
  expect(liftWeight('thermal', ON, [1, 1, 1, 1])).toBeCloseTo(0.25, 9);
  expect(liftWeight('thermal', ON, [3, 1, 0, 0])).toBeCloseTo(0.75, 9);
  // Disabling a component redistributes its share; it does not leave a hole.
  expect(liftWeight('thermal', [true, false, true, true], [1, 1, 1, 1])).toBeCloseTo(1 / 3, 9);
  expect(liftWeight('slope', [true, false, true, true], [1, 1, 1, 1])).toBe(0);
});

test('a mixer setting saved by an older version pads instead of breaking', () => {
  expect(liftWeight('thermal', [true, true], [1, 1])).toBeCloseTo(0.5, 9);   // 2 of 4 known
  expect(liftWeight('wave', [], [])).toBe(0);                                // nothing set at all
  expect(liftWeight('nonesuch', ON, [1, 1, 1, 1])).toBe(0);
});

// ---- the simplex ----

const TRI = simplexVerts(3, 100, 100, 60);
const QUAD = simplexVerts(4, 100, 100, 60);

test('a vertex is that component alone; the centroid is an equal blend', () => {
  expect(weightsFromPoint(TRI[0][0], TRI[0][1], TRI)).toEqual([1, 0, 0]);
  const c = pointFromWeights([1, 1, 1], TRI);
  const w = weightsFromPoint(c[0], c[1], TRI);
  for (const x of w) expect(x).toBeCloseTo(1 / 3, 6);
});

test('on a triangle, weights and points are exact inverses', () => {
  // For a TRIANGLE, mean-value coordinates coincide with the barycentric ones, so the round
  // trip is exact: place the handle from a blend, read the blend back, get the same numbers.
  const w0 = [0.5, 0.2, 0.3];
  const p = pointFromWeights(w0, TRI);
  const w1 = weightsFromPoint(p[0], p[1], TRI);
  for (let i = 0; i < 3; i++) expect(w1[i]).toBeCloseTo(w0[i], 5);
});

test('beyond a triangle the round trip is NOT exact — and that is geometry, not a bug', () => {
  // Mean-value coordinates only agree with the affine ones on a simplex. A square is not a
  // simplex in the plane: four weights over two dimensions are under-determined, so many
  // blends map to the same point and the map cannot be inverted. With four components (the
  // default!), placing the handle from a stored blend and reading it back gives a DIFFERENT
  // blend — one that shares the same handle position.
  //
  // It is not a bug as long as the stored weights stay the source of truth and are only
  // rewritten when the user actually drags. Worth knowing before anyone "simplifies" the
  // widget into round-tripping through the handle.
  const w0 = [0.5, 0.2, 0.3, 0.1];
  const sum = w0.reduce((a, b) => a + b, 0);
  const p = pointFromWeights(w0, QUAD);
  const w1 = weightsFromPoint(p[0], p[1], QUAD);
  expect(w1.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);          // still a valid blend
  expect(w1[0]).not.toBeCloseTo(w0[0] / sum, 2);                    // but not the one we put in
  // ...and it maps back to the same handle: the point is what is preserved, not the weights.
  const p2 = pointFromWeights(w1, QUAD);
  expect(p2[0]).toBeCloseTo(p[0], 4);
  expect(p2[1]).toBeCloseTo(p[1], 4);
});

test('the weights always sum to one, wherever the handle is', () => {
  for (const [x, y] of [[100, 100], [80, 90], [140, 130], [100, 41]]) {
    const w = weightsFromPoint(x, y, QUAD);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
  }
});

test('dragging outside snaps to the nearest edge, not to the opposite vertex', () => {
  // This is the bug clampToSimplex exists to prevent: outside the polygon the mean-value
  // weights go negative and the handle jumps across the mixer. It must land on the edge you
  // dragged toward.
  const far: [number, number] = [400, 100];                  // way out to the right
  const q = clampToSimplex(far[0], far[1], TRI);
  expect(q[0]).toBeLessThan(180);                            // pulled back inside the box
  const w = weightsFromPoint(q[0], q[1], TRI);
  for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
  expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
});

test('a point already inside is left where it is', () => {
  expect(clampToSimplex(100, 100, TRI)).toEqual([100, 100]);
});

test('two components make an axis, one makes a point', () => {
  const seg = simplexVerts(2, 100, 100, 60);
  expect(weightsFromPoint(seg[0][0], seg[0][1], seg)).toEqual([1, 0]);
  expect(weightsFromPoint(100, 100, seg)).toEqual([0.5, 0.5]);
  expect(weightsFromPoint(0, 0, simplexVerts(1, 100, 100, 60))).toEqual([1]);
});

// ---- calibration ----

test('the calibration is the median ratio of observed climb to predicted', () => {
  const pairs = [1.0, 2.0, 2.0, 3.0].map(observed => ({ observed, predicted: 1 }));
  expect(calibrationFactor(pairs)).toBeCloseTo(2, 6);
});

test('one wild detection does not move the calibration — that is why it is a median', () => {
  const sane = [1.9, 2.0, 2.1, 2.0].map(observed => ({ observed, predicted: 1 }));
  const withPhantom = [...sane, { observed: 99, predicted: 1 }];
  expect(calibrationFactor(withPhantom)).toBeCloseTo(calibrationFactor(sane), 0);
});

test('too few climbs means no calibration at all — a refusal, not a guess', () => {
  expect(calibrationFactor([{ observed: 5, predicted: 1 }])).toBe(1);
  expect(calibrationFactor([])).toBe(1);
});

test('the factor is clamped: a wild ratio is a bad detection, not a wild day', () => {
  const huge = Array.from({ length: 6 }, () => ({ observed: 50, predicted: 1 }));
  const tiny = Array.from({ length: 6 }, () => ({ observed: 0.01, predicted: 1 }));
  expect(calibrationFactor(huge)).toBe(CAL_MAX);
  expect(calibrationFactor(tiny)).toBe(CAL_MIN);
});

test('predictions too weak to divide by are dropped, not allowed to explode', () => {
  const pairs = [
    ...Array.from({ length: 4 }, () => ({ observed: 2, predicted: 1 })),
    ...Array.from({ length: 4 }, () => ({ observed: 2, predicted: 0.001 })),   // would give a ratio of 2000
  ];
  expect(calibrationFactor(pairs)).toBeCloseTo(2, 6);
  expect(calibrationFactor(pairs.slice(4))).toBe(1);   // nothing usable left → no calibration
});

test('the predicted updraught refuses to guess where the ground is unknown', () => {
  const ground: ElevSampler = () => 1000;
  const rad = { dni: 900, diff: 90, convTop: NaN, ziFallback: 1500 };
  const up: [number, number, number] = [0, 0, 1];
  expect(predictVzAt(6, 45, ground, up, rad)).toBeGreaterThan(0);
  expect(predictVzAt(6, 45, () => null, up, rad)).toBeNull();          // no DEM here
  expect(predictVzAt(6, 45, ground, [0, 0, -0.5], rad)).toBeNull();    // sun below the horizon
  expect(predictVzAt(6, 45, ground, up, { ...rad, convTop: 1050 })).toBeNull();   // no depth to convect in
});
