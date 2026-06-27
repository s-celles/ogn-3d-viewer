import { test, expect } from 'bun:test';
import { posAt, airborne, slice, brg, varioAt, headingAt } from './flight-math';
import type { RenderTrack } from './types';

// A simple synthetic track: climbs 0→200 m while moving east, rel time 0→20 s.
const tr: RenderTrack = {
  label: 'ASK21', reg: 'F-TEST', maxalt: 200, color: [255, 0, 0],
  path: [], tstart: 0, tend: 20,
  rel: [
    [0.000, 0, 0, 0],
    [0.000, 0, 100, 10],
    [0.001, 0, 200, 20],
  ],
  rstart: 0, rend: 20,
};

test('posAt interpolates linearly and clamps to ends', () => {
  expect(posAt(tr, 5)).toEqual([0, 0, 50]);
  expect(posAt(tr, -5)).toEqual([0, 0, 0]);     // before start → first point
  expect(posAt(tr, 999)).toEqual([0.001, 0, 200]); // after end → last point
});

test('airborne respects the track span', () => {
  expect(airborne(tr, 10)).toBe(true);
  expect(airborne(tr, -1)).toBe(false);
  expect(airborne(tr, 21)).toBe(false);
});

test('varioAt returns the climb rate in m/s', () => {
  // window [1,9]: alt 10 → 90 over 8 s = 10 m/s
  expect(varioAt(tr, 5)).toBeCloseTo(10, 6);
});

test('brg gives a compass bearing, null when coincident', () => {
  expect(brg([0, 0, 0], [0, 1, 0])).toBeCloseTo(0, 3);   // due north
  expect(brg([0, 0, 0], [1, 0, 0])).toBeCloseTo(90, 3);  // due east
  expect(brg([0, 0, 0], [0, 0, 0])).toBeNull();
});

test('headingAt points east on the eastbound segment', () => {
  expect(headingAt(tr, 17)).toBeGreaterThan(45);
  expect(headingAt(tr, 17)).toBeLessThan(135);
});

test('slice clamps to span and includes endpoints', () => {
  const s = slice(tr, -100, 100);
  expect(s[0]).toEqual([0, 0, 0]);
  expect(s[s.length - 1]).toEqual([0.001, 0, 200]);
  expect(slice(tr, 15, 5)).toEqual([]); // inverted range
});
