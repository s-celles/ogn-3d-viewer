import { test, expect } from 'bun:test';
import { posAt, airborne, slice, brg, varioAt, headingAt, buildRel, attitudeAt } from './flight-math';
import { GLIDER } from './config';
import type { RenderTrack, TrackPoint, RelPoint } from './types';

// Build a synthetic RenderTrack from [lon,lat,alt,relTime] points.
function mkTrack(rel: RelPoint[]): RenderTrack {
  return { label: 'x', reg: 'R', maxalt: 0, color: [0, 0, 0], path: [], tstart: rel[0][3], tend: rel[rel.length - 1][3], rel, rstart: rel[0][3], rend: rel[rel.length - 1][3] };
}

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

test('buildRel: linear mode just shifts time by G0', () => {
  const path: TrackPoint[] = [[0, 0, 0, 100], [1, 0, 10, 110], [2, 0, 5, 120]];
  const rel = buildRel(path, 100, false);
  expect(rel.length).toBe(3);
  expect(rel[0]).toEqual([0, 0, 0, 0]);
  expect(rel[2]).toEqual([2, 0, 5, 20]);
});

test('buildRel: spline densifies, preserves beacons and endpoints, time monotonic', () => {
  const path: TrackPoint[] = [[0, 0, 0, 0], [1, 0, 10, 10], [2, 0, 5, 20], [3, 0, 15, 30]];
  const rel = buildRel(path, 0, true);
  // 8 subdivisions per segment over 3 segments + final endpoint
  expect(rel.length).toBe(8 * 3 + 1);
  expect(rel[0]).toEqual([0, 0, 0, 0]);                       // first beacon
  expect(rel[rel.length - 1]).toEqual([3, 0, 15, 30]);        // last beacon
  // Catmull-Rom passes through control points: every 8th sample is an original beacon
  expect(rel[8][0]).toBeCloseTo(1, 6); expect(rel[8][2]).toBeCloseTo(10, 6);
  expect(rel[16][0]).toBeCloseTo(2, 6); expect(rel[16][2]).toBeCloseTo(5, 6);
  // strictly increasing time
  for (let i = 1; i < rel.length; i++) expect(rel[i][3]).toBeGreaterThan(rel[i - 1][3]);
});

test('buildRel: too few points falls back to linear', () => {
  const path: TrackPoint[] = [[0, 0, 0, 0], [1, 0, 10, 10]];
  expect(buildRel(path, 0, true).length).toBe(2);
});

const maxBankRad = GLIDER.maxBankDeg * Math.PI / 180;
const maxPitchRad = GLIDER.maxPitchDeg * Math.PI / 180;

test('attitudeAt: straight & level → no roll, no pitch', () => {
  const tr = mkTrack([[0, 45, 1000, 0], [0.001, 45, 1000, 5], [0.002, 45, 1000, 10], [0.003, 45, 1000, 15], [0.004, 45, 1000, 20]]);
  const a = attitudeAt(tr, 10);
  expect(Math.abs(a.roll)).toBeLessThan(0.02);
  expect(Math.abs(a.pitch)).toBeLessThan(0.02);
  expect(a.speed).toBeGreaterThan(0);
});

test('attitudeAt: climb → nose up, descent → nose down (clamped)', () => {
  const climb = mkTrack([[0, 45, 0, 0], [0.001, 45, 100, 5], [0.002, 45, 200, 10], [0.003, 45, 300, 15], [0.004, 45, 400, 20]]);
  expect(attitudeAt(climb, 10).pitch).toBeGreaterThan(0.1);
  expect(attitudeAt(climb, 10).pitch).toBeLessThanOrEqual(maxPitchRad + 1e-9);
  const descent = mkTrack([[0, 45, 400, 0], [0.001, 45, 300, 5], [0.002, 45, 200, 10], [0.003, 45, 100, 15], [0.004, 45, 0, 20]]);
  expect(attitudeAt(descent, 10).pitch).toBeLessThan(-0.1);
});

test('attitudeAt: right turn banks right, left turn banks left, capped at max', () => {
  // heading sweeps from north toward east → right (clockwise) turn
  const right = mkTrack([[0, 45, 1000, 0], [0, 45.001, 1000, 3], [0.0003, 45.0014, 1000, 6], [0.0009, 45.0016, 1000, 9], [0.0016, 45.0016, 1000, 12]]);
  const r = attitudeAt(right, 6).roll;
  expect(r).toBeGreaterThan(0);
  expect(r).toBeLessThanOrEqual(maxBankRad + 1e-9);
  // mirror in longitude → heading sweeps north toward west → left turn
  const left = mkTrack([[0, 45, 1000, 0], [0, 45.001, 1000, 3], [-0.0003, 45.0014, 1000, 6], [-0.0009, 45.0016, 1000, 9], [-0.0016, 45.0016, 1000, 12]]);
  expect(attitudeAt(left, 6).roll).toBeLessThan(0);
});

test('slice clamps to span and includes endpoints', () => {
  const s = slice(tr, -100, 100);
  expect(s[0]).toEqual([0, 0, 0]);
  expect(s[s.length - 1]).toEqual([0.001, 0, 200]);
  expect(slice(tr, 15, 5)).toEqual([]); // inverted range
});
