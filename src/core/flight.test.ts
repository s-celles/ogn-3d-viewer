// A flight, read off its track: where it was, how fast it climbed, how it was banked, what it
// added up to. These are closed-form claims about a synthetic flight — no app state, no
// RenderTrack, no renderer.
import { test, expect } from 'bun:test';
import {
  buildRel, posAt, airborne, slice, brg, headingAt, varioAt, groundSpeedAt, compVarioAt,
  flightStats, attitudeAt, type FlightPath, type Dynamics,
} from './flight';
import type { RelPoint, TrackPoint } from './types';

const path = (rel: RelPoint[]): FlightPath => ({ rel, rstart: rel[0][3], rend: rel[rel.length - 1][3] });

/** Climbs 0 → 200 m while drifting east, over 20 s. */
const climbing = path([[0.000, 0, 0, 0], [0.000, 0, 100, 10], [0.001, 0, 200, 20]]);

// The project's real flight dynamics — a test on invented constants proves nothing about
// what ships.
const DYN: Dynamics = { g: 9.81, dt: 3, maxBankDeg: 55, maxPitchDeg: 35, pitchLevelSpeed: 19, pitchGain: 0.0085 };

/** A straight, level run east at `v` m/s, sampled every second. */
const level = (v: number, dur = 40, alt = 1000): FlightPath => {
  const rel: RelPoint[] = [];
  for (let t = 0; t <= dur; t++) rel.push([v * t / 111320, 0, alt, t]);
  return path(rel);
};
/** A steady turn of radius r at speed v, starting eastbound. `sign` = +1 right (curving south),
 *  −1 left (curving north). */
const turning = (v: number, r: number, sign: number, dur = 60): FlightPath => {
  const rel: RelPoint[] = [];
  for (let t = 0; t <= dur; t++) {
    const a = v / r * t;
    rel.push([(r * Math.sin(a)) / 111320, (-sign * r * (1 - Math.cos(a))) / 111320, 1000, t]);
  }
  return path(rel);
};

// ---- reading the track ----

test('posAt interpolates linearly and clamps to the ends', () => {
  expect(posAt(climbing, 5)[2]).toBeCloseTo(50, 6);
  expect(posAt(climbing, 15)[2]).toBeCloseTo(150, 6);
  expect(posAt(climbing, -100)[2]).toBe(0);      // before the track: the first fix
  expect(posAt(climbing, 9999)[2]).toBe(200);    // after it: the last
});

test('airborne respects the track span', () => {
  expect(airborne(climbing, 10)).toBe(true);
  expect(airborne(climbing, -1)).toBe(false);
  expect(airborne(climbing, 21)).toBe(false);
});

test('slice clamps to the span and keeps its endpoints', () => {
  const s = slice(climbing, 5, 15);
  expect(s[0][2]).toBeCloseTo(50, 6);
  expect(s[s.length - 1][2]).toBeCloseTo(150, 6);
  expect(slice(climbing, 30, 40)).toEqual([]);   // entirely outside
});

test('brg gives a compass bearing, and null when the points coincide', () => {
  expect(brg([0, 0, 0], [0, 1, 0])).toBeCloseTo(0, 3);     // north
  expect(brg([0, 0, 0], [1, 0, 0])).toBeCloseTo(90, 3);    // east
  expect(brg([0, 0, 0], [0, -1, 0])).toBeCloseTo(180, 3);  // south
  expect(brg([0, 0, 0], [0, 0, 0])).toBeNull();
});

test('headingAt points east on an eastbound leg', () => {
  expect(headingAt(level(30), 20)).toBeCloseTo(90, 1);
});

test('varioAt is the climb rate in m/s', () => {
  expect(varioAt(climbing, 10)).toBeCloseTo(10, 6);        // 200 m in 20 s
  expect(varioAt(level(30), 20)).toBeCloseTo(0, 6);
});

test('groundSpeedAt measures the speed over the ground', () => {
  expect(groundSpeedAt(level(30), 20, 3)).toBeCloseTo(30, 1);
});

// ---- the total-energy vario ----

test('the compensated vario equals the raw one at constant speed', () => {
  // No acceleration → no kinetic term → nothing to compensate.
  const p = level(30);
  expect(compVarioAt(p, 20, 3, 9.81)).toBeCloseTo(varioAt(p, 20), 3);
});

test('a pull-up reads BELOW the raw vario — the height was bought with speed', () => {
  // Level and fast, then zoom: climbing while decelerating. The raw vario sees lift; the
  // compensated one sees the kinetic energy being spent, and says so. This is the whole point
  // of a TE vario, and the reason a pull-up must not read as a thermal.
  const rel: RelPoint[] = [];
  for (let t = 0; t <= 40; t++) {
    const v = t < 20 ? 50 : 50 - 2 * (t - 20);          // 50 m/s, then decelerating hard
    const alt = t < 20 ? 1000 : 1000 + 3 * (t - 20);    // and converting it into height
    const prev: RelPoint | undefined = rel[rel.length - 1];
    const x = (prev ? prev[0] * 111320 : 0) + v;
    rel.push([x / 111320, 0, alt, t]);
  }
  const p = path(rel);
  expect(varioAt(p, 30)).toBeGreaterThan(0);                            // the raw vario sees a climb
  expect(compVarioAt(p, 30, 3, 9.81)).toBeLessThan(varioAt(p, 30));     // the TE vario is not fooled
});

// ---- attitude ----

test('straight and slow: no bank, and the body sits level', () => {
  const a = attitudeAt(level(18), 20, false, DYN);   // below pitchLevelSpeed
  expect(a.roll).toBeCloseTo(0, 2);
  expect(a.pitch).toBeCloseTo(0, 2);
  expect(a.speed).toBeCloseTo(18, 0);
});

test('the faster a glider goes, the more nose-down it sits', () => {
  const slow = attitudeAt(level(25), 20, false, DYN).pitch;
  const fast = attitudeAt(level(50), 20, false, DYN).pitch;
  expect(slow).toBeLessThan(0);
  expect(fast).toBeLessThan(slow);
});

test('a right turn banks right, a left turn banks left', () => {
  expect(attitudeAt(turning(30, 150, +1), 30, false, DYN).roll).toBeGreaterThan(0.2);
  expect(attitudeAt(turning(30, 150, -1), 30, false, DYN).roll).toBeLessThan(-0.2);
});

test('the bank is capped, so a glitched track cannot invert the glider', () => {
  const max = DYN.maxBankDeg * Math.PI / 180;
  const violent = attitudeAt(turning(60, 20, +1), 30, false, DYN);   // an absurd 20 m radius at 60 m/s
  expect(violent.roll).toBeLessThanOrEqual(max + 1e-9);
});

test('a glider never pitches nose-up, however well it is climbing', () => {
  // A glider is always descending through the AIR. A thermal carries it up without pitching
  // the nose up — so pitch follows airspeed, not vario. Getting this wrong makes every
  // circling glider on the map point at the sky.
  const rel: RelPoint[] = [];
  for (let t = 0; t <= 40; t++) rel.push([25 * t / 111320, 0, 1000 + 3 * t, t]);   // climbing at 3 m/s
  const a = attitudeAt(path(rel), 20, false, DYN);
  expect(a.pitch).toBeLessThanOrEqual(0);
});

test('a powered aircraft DOES pitch up when it climbs', () => {
  const rel: RelPoint[] = [];
  for (let t = 0; t <= 40; t++) rel.push([25 * t / 111320, 0, 1000 + 3 * t, t]);
  expect(attitudeAt(path(rel), 20, true, DYN).pitch).toBeGreaterThan(0);
});

// ---- the flight as a whole ----

test('the stats come out of one pass: distance, cumulative gain, duration, speeds', () => {
  // Up 100, down 50, up 100: the cumulative gain is 200 (only the climbs), not the net 150.
  const rel: RelPoint[] = [
    [0, 0, 1000, 0], [0.01, 0, 1100, 60], [0.02, 0, 1050, 120], [0.03, 0, 1150, 180],
  ];
  const st = flightStats(path(rel), 1150);
  expect(st.dur).toBe(180);
  expect(st.gain).toBeCloseTo(200, 6);
  expect(st.maxAlt).toBe(1150);
  expect(st.distKm).toBeCloseTo(0.03 * 111320 / 1000, 1);
  expect(st.avgKmh).toBeCloseTo(st.distKm / (180 / 3600), 1);
});

test('one glitched beacon cannot blow up the maxima — they are 98th percentiles', () => {
  const rel: RelPoint[] = [];
  for (let t = 0; t <= 600; t += 4) rel.push([30 * t / 111320, 0, 1000 + t, t]);   // steady 30 m/s, +1 m/s
  const clean = flightStats(path(rel), 1600);
  const glitched = [...rel];
  glitched.splice(50, 0, [999 / 111320, 0, 9000, glitched[49][3] + 1]);            // a wild fix
  const dirty = flightStats(path(glitched), 9000);
  expect(dirty.maxKmh).toBeLessThan(clean.maxKmh * 1.5);   // the percentile absorbs it
});

// ---- building the path ----

test('linear mode just shifts the clock by the day origin and corrects the datum', () => {
  const raw: TrackPoint[] = [[6, 45, 1050, 36000], [6.01, 45, 1100, 36010]];
  const rel = buildRel(raw, 36000, false, 50);   // 50 m of geoid correction
  expect(rel).toEqual([[6, 45, 1000, 0], [6.01, 45, 1050, 10]]);
});

test('the spline passes THROUGH every beacon — a smoothed track is not a made-up one', () => {
  const raw: TrackPoint[] = [
    [6, 45, 1000, 0], [6.01, 45.01, 1100, 10], [6.02, 45.0, 1200, 20], [6.03, 45.01, 1300, 30],
  ];
  const rel = buildRel(raw, 0, true, 0);
  expect(rel.length).toBeGreaterThan(raw.length);
  // Every original beacon survives, at its own time.
  for (const b of raw) {
    const hit = rel.find(r => Math.abs(r[3] - b[3]) < 1e-6);
    expect(hit).toBeDefined();
    expect(hit![0]).toBeCloseTo(b[0], 9);
    expect(hit![1]).toBeCloseTo(b[1], 9);
  }
  // Time stays monotonic, and the endpoints are exact.
  for (let i = 1; i < rel.length; i++) expect(rel[i][3]).toBeGreaterThanOrEqual(rel[i - 1][3]);
  expect(rel[rel.length - 1]).toEqual([6.03, 45.01, 1300, 30]);
});

test('too few points to spline stay linear rather than being invented', () => {
  const raw: TrackPoint[] = [[6, 45, 1000, 0], [6.01, 45, 1100, 10]];
  expect(buildRel(raw, 0, true, 0).length).toBe(2);
});
