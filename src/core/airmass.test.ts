// The detectors read the air off the gliders that flew it. The hard part is not finding a
// climb — it is telling the three kinds apart, because all three go up:
//   a thermal circles          → ≥ 360° of net heading
//   a ridge beat runs straight → but hugs the terrain
//   a wave beat runs straight  → and is high above it
// So these tests fly synthetic gliders through each, and demand that each detector claims its
// own and rejects the other two. No app state, no tracks on disk, no renderer.
import { test, expect } from 'bun:test';
import { detectThermals, detectClimbs, thermalDrift } from './airmass';
import { detectWave, detectWaveClimbs } from './wavemass';
import { M_PER_LAT, mPerLng } from './geo';
import type { ElevSampler, Probe } from './ports';

const LON = 6, LAT = 45;
const mLng = mPerLng(LAT);
const east = (lon: number) => (lon - LON) * mLng;
const north = (lat: number) => (lat - LAT) * M_PER_LAT;

/** A probe from a parametric flight path (metres east/north of the origin, metres AMSL). */
const probe = (rstart: number, rend: number, path: (t: number) => [number, number, number]): Probe => ({
  rstart, rend,
  at: (t: number) => {
    const [x, y, alt] = path(Math.max(rstart, Math.min(rend, t)));
    return [LON + x / mLng, LAT + y / M_PER_LAT, alt] as const;
  },
});

/** A glider circling in a thermal: radius `r`, one turn every `period` s, climbing at `vz`,
 *  the whole column drifting downwind at `drift` m/s eastward. */
const circling = (dur: number, vz: number, drift = 0, r = 90, period = 25) =>
  probe(0, dur, t => [
    drift * t + r * Math.cos(2 * Math.PI * t / period),
    r * Math.sin(2 * Math.PI * t / period),
    1000 + vz * t,
  ]);

/** A glider beating back and forth along a ridge: straight legs, 180° turns, climbing. */
const ridgeBeat = (dur: number, vz: number, leg = 60) =>
  probe(0, dur, t => {
    const phase = Math.floor(t / leg) % 2, u = (t % leg) / leg;
    const along = phase === 0 ? u * 1800 : (1 - u) * 1800;
    return [along, 0, 1000 + vz * t];
  });

/** A glider beating into wind in wave: nearly straight, slow, climbing steadily, high up. */
const waveBeat = (dur: number, vz: number, alt0 = 2500) =>
  probe(0, dur, t => [t * 12, Math.sin(t / 200) * 40, alt0 + vz * t]);

const GROUND: ElevSampler = () => 1000;   // a plain at 1000 m

// ---- thermals ----

test('a circling climb is a thermal', () => {
  const th = detectClimbs(circling(300, 2.0));
  expect(th.length).toBe(1);
  expect(th[0].strength).toBeCloseTo(2.0, 1);
  expect(th[0].top - th[0].base).toBeCloseTo(600, -1.4);   // 300 s at 2 m/s
});

test('a ridge beat is NOT a thermal, however well it climbs', () => {
  // It goes up, it even turns — but it never sweeps a full circle. That is the whole point
  // of MIN_TURN: without it, every ridge day would be covered in phantom thermals.
  expect(detectClimbs(ridgeBeat(600, 1.5))).toEqual([]);
});

test('circling level is not a thermal', () => {
  expect(detectClimbs(circling(300, 0))).toEqual([]);       // just turning: a wait, or a hold
});

test('a spiral DESCENT is not a thermal — a thermal goes UP', () => {
  expect(detectClimbs(circling(300, -3))).toEqual([]);
  expect(detectClimbs(circling(300, -1))).toEqual([]);
});

test('a climb that gives half of itself back is worth what it netted', () => {
  // Up 300 m, then down 150 m, all while circling: the run gained 150 m, not 300. The range
  // would say 300. Strength is the NET gain, which is what the pilot actually got.
  const upThenDown = probe(0, 300, t => [
    90 * Math.cos(2 * Math.PI * t / 25), 90 * Math.sin(2 * Math.PI * t / 25),
    1000 + (t < 200 ? 1.5 * t : 300 - 1.5 * (t - 200)),
  ]);
  const th = detectClimbs(upThenDown);
  expect(th.length).toBe(1);
  expect(th[0].strength).toBeCloseTo(150 / 300, 1);   // 0.5 m/s net, not 1.0
});

test('a climb too short, too weak or too small to matter is dropped', () => {
  expect(detectClimbs(circling(20, 2))).toEqual([]);        // under MIN_RUN
  expect(detectClimbs(circling(300, 0.2))).toEqual([]);     // under MIN_STRENGTH
  expect(detectClimbs(circling(60, 1))).toEqual([]);        // 60 m of gain — under MIN_GAIN
});

test('BUG (pinned): the drift reads the wind a third too slow', () => {
  // c0 and c1 are the means of the FIRST and LAST THIRD of the run, so they are only ~2/3 of
  // the window apart in time — yet the drift divides their separation by the FULL window. The
  // wind read off the air comes out ~33% too slow, systematically. It is the last-resort wind
  // when there is no forecast, so it feeds the ridge, convergence and wave fields.
  // Preserved exactly here; fixed in a later commit.
  const th = detectClimbs(circling(400, 2, 5));             // 5 m/s of eastward drift
  expect(th.length).toBe(1);
  const drift = thermalDrift(th)!;
  expect(drift[0]).toBeCloseTo(5 * 2 / 3, 0);               // east — should be 5
  expect(drift[1]).toBeCloseTo(0, 0);                       // north
  expect(thermalDrift([])).toBeNull();
});

test('several gliders in one thermal are one thermal', () => {
  // The same air, found by three gliders a few dozen metres apart — not three thermals.
  const gliders = [0, 40, 80].map(off => probe(0, 300, t => [
    off + 90 * Math.cos(2 * Math.PI * t / 25), 90 * Math.sin(2 * Math.PI * t / 25), 1000 + 2 * t,
  ]));
  expect(detectThermals(gliders).length).toBe(1);
});

test('two thermals a kilometre apart stay two thermals', () => {
  const here = probe(0, 300, t => [90 * Math.cos(2 * Math.PI * t / 25), 90 * Math.sin(2 * Math.PI * t / 25), 1000 + 2 * t]);
  const there = probe(0, 300, t => [3000 + 90 * Math.cos(2 * Math.PI * t / 25), 90 * Math.sin(2 * Math.PI * t / 25), 1000 + 2 * t]);
  expect(detectThermals([here, there]).length).toBe(2);
});

test('the strongest thermals come first, and the list is capped', () => {
  const gliders = [1, 3, 2].map((vz, i) => probe(0, 300, t => [
    i * 4000 + 90 * Math.cos(2 * Math.PI * t / 25), 90 * Math.sin(2 * Math.PI * t / 25), 1000 + vz * t,
  ]));
  const ths = detectThermals(gliders);
  expect(ths.map(t => Math.round(t.strength))).toEqual([3, 2, 1]);
  expect(detectThermals(gliders, 2).length).toBe(2);
});

// ---- wave ----

test('a straight sustained climb high above the ground is wave', () => {
  const w = detectWaveClimbs(waveBeat(400, 1.5), GROUND);
  expect(w.length).toBe(1);
  expect(w[0].strength).toBeCloseTo(1.5, 1);
  expect(w[0].top).toBeGreaterThan(3000);
});

test('the same straight climb DOWN on the deck is a ridge beat, not wave', () => {
  // Identical flight, identical climb — but 60 m above the ground instead of 1500. AGL_MIN is
  // the only thing telling them apart, and it has to hold.
  const climb = probe(0, 400, t => [t * 12, Math.sin(t / 200) * 40, 1060 + 1.5 * t]);   // 1060 → 1660 m
  expect(detectWaveClimbs(climb, () => 1000).length).toBe(1);   // a plain 660 m below → wave
  expect(detectWaveClimbs(climb, () => 1450)).toEqual([]);      // a ridge 210 m below → a beat
});

test('a circling climb is NOT wave', () => {
  expect(detectWaveClimbs(circling(400, 2), GROUND)).toEqual([]);   // it sweeps far past MAX_NET
});

test('wave is long: a short straight climb does not count', () => {
  expect(detectWaveClimbs(waveBeat(60, 1.5), GROUND)).toEqual([]);  // under MIN_RUN
  expect(detectWaveClimbs(waveBeat(400, 0.2), GROUND)).toEqual([]); // under MIN_STRENGTH
});

test('several beats in the same bar merge into one', () => {
  const beats = [0, 300, 600].map(off => probe(0, 400, t => [off + t * 12, Math.sin(t / 200) * 40, 2500 + 1.5 * t]));
  expect(detectWave(beats, GROUND).length).toBe(1);
});

test('unknown ground does not veto a wave climb', () => {
  // A null elevation means "not loaded", not "sea level". A climb over unmapped ground must
  // still be reported — refusing to guess is not the same as refusing to see.
  expect(detectWaveClimbs(waveBeat(400, 1.5), () => null).length).toBe(1);
});
