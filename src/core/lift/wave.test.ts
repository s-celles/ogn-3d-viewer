// A lee wave is a resonance: a stable airstream crossing a ridge oscillates downwind at
// λ = 2π·U/N. That is a closed-form claim, so these tests make the model prove it — put an
// analytic ridge in an analytic wind and measure the wavelength that comes out, check the
// air upwind of the ridge is undisturbed (a wave is a *lee* phenomenon), and watch the
// train decay downwind. No app state, no DEM tiles, no renderer.
import { test, expect } from 'bun:test';
import { waveField, waveResonance, rotorSpots, ETA_MAX, ROTOR_W, ROTOR_MAX } from './wave';
import type { NodeGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

const G: NodeGrid = { cLon: 6, cLat: 45, R: 20000, n: 80 };
const mLng = mPerLng(G.cLat);
const east = (lon: number) => (lon - G.cLon) * mLng;

const flat: ElevSampler = () => 1000;
/** A north–south ridge (invariant along y), Gaussian across the flow, centred at x = x0. */
const ridge = (h: number, L: number, x0: number): ElevSampler =>
  (lon) => 1000 + h * Math.exp(-((east(lon) - x0) ** 2) / (2 * L * L));

const WEST_WIND = [15, 0] as const;   // 15 m/s towards the east
const N_STABLE = 0.011;               // 1/s — a stable airstream
const RIDGE_X = -8000;                // the ridge sits upwind of the domain centre
const RES = waveResonance(WEST_WIND, N_STABLE)!;

/** The field along the centre row (y ≈ 0), west to east. */
const profile = (f: ReturnType<typeof waveField>) => {
  const j = Math.round((G.n - 1) / 2);
  return Array.from({ length: G.n }, (_, i) => ({
    x: east(f.lon[i]), w: f.w[j * G.n + i], eta: f.eta[j * G.n + i],
  }));
};
/** Where a profile crosses zero, downwind of the ridge. */
const zeros = (prof: { x: number; w: number }[], from: number) => {
  const zs: number[] = [];
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1].w, b = prof[i].w;
    if (prof[i].x > from && a * b < 0)
      zs.push(prof[i - 1].x + (prof[i].x - prof[i - 1].x) * Math.abs(a) / (Math.abs(a) + Math.abs(b)));
  }
  return zs;
};

// ---- the resonance gate ----

test('the Scorer relation: λ = 2π·U/N', () => {
  expect(RES.lambda).toBeCloseTo(2 * Math.PI * 15 / N_STABLE, 6);
  expect(RES.l).toBeCloseTo(N_STABLE / 15, 9);
});

test('no wave without wind, without stability, or at an implausible wavelength', () => {
  expect(waveResonance([6, 0], N_STABLE)).toBeNull();      // too little wind to force one
  expect(waveResonance([15, 0], 0.005)).toBeNull();        // neutral air: nothing to oscillate
  expect(waveResonance([7, 0], 0.03)).toBeNull();          // λ ≈ 1.5 km — too short to be real
  expect(waveResonance([35, 0], 0.0061)).toBeNull();       // λ ≈ 36 km — too long to be real
  expect(waveResonance([15, 0], N_STABLE)).not.toBeNull();
});

// ---- the wave itself ----

test('flat ground makes no wave, however stable and windy the air', () => {
  const f = waveField(G, flat, WEST_WIND, { res: RES });
  expect(f.ready).toBeGreaterThan(0);   // the ground IS loaded — there is simply nothing to force it
  expect(Array.from(f.w).every(v => v === 0)).toBe(true);
  expect(Array.from(f.eta).every(v => v === 0)).toBe(true);
});

test('the air upwind of the ridge is undisturbed — the wave is a LEE phenomenon', () => {
  const prof = profile(waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: RES }));
  // Well upwind of the ridge (more than a couple of ridge-widths), nothing is moving.
  for (const p of prof.filter(p => p.x < RIDGE_X - 4000)) {
    expect(Math.abs(p.w)).toBeLessThan(0.01);
    expect(Math.abs(p.eta)).toBeLessThan(1);
  }
});

test('downwind of the ridge the flow oscillates at exactly the resonant wavelength', () => {
  const prof = profile(waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: RES }));
  const zs = zeros(prof, RIDGE_X);
  expect(zs.length).toBeGreaterThanOrEqual(4);   // several crests and troughs in the domain
  // Successive zero crossings of a sinusoid are half a wavelength apart. The tolerance is
  // the grid itself: at 506 m node spacing a crossing is only located to about ±250 m.
  const gaps = zs.slice(1).map((z, i) => z - zs[i]);
  for (const gap of gaps) expect(Math.abs(gap - RES.lambda / 2) / (RES.lambda / 2)).toBeLessThan(0.06);
});

test('a shorter wavelength comes out of a stronger stability', () => {
  // λ = 2π·U/N: double N, halve λ — the wave train packs together.
  const soft = waveResonance(WEST_WIND, 0.008)!, hard = waveResonance(WEST_WIND, 0.016)!;
  expect(hard.lambda).toBeCloseTo(soft.lambda / 2, 6);
  const zsSoft = zeros(profile(waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: soft })), RIDGE_X);
  const zsHard = zeros(profile(waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: hard })), RIDGE_X);
  expect(zsHard.length).toBeGreaterThan(zsSoft.length);   // more crests fit in the same domain
});

test('the wave train decays downwind', () => {
  const prof = profile(waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: RES }));
  // Peak |w| in the first wavelength after the ridge, versus two wavelengths further out.
  const peak = (a: number, b: number) =>
    Math.max(...prof.filter(p => p.x >= a && p.x < b).map(p => Math.abs(p.w)));
  const near = peak(RIDGE_X, RIDGE_X + RES.lambda);
  const far = peak(RIDGE_X + 2 * RES.lambda, RIDGE_X + 3 * RES.lambda);
  expect(far).toBeLessThan(near);
});

test('a taller ridge drives a stronger wave', () => {
  const small = profile(waveField(G, ridge(300, 1200, RIDGE_X), WEST_WIND, { res: RES }));
  const big = profile(waveField(G, ridge(900, 1200, RIDGE_X), WEST_WIND, { res: RES }));
  const amp = (prof: { x: number; w: number }[]) => Math.max(...prof.map(p => Math.abs(p.w)));
  expect(amp(big)).toBeGreaterThan(amp(small));
});

test('the streamline displacement is clamped, so the stacked sheets can never cross', () => {
  const f = waveField(G, ridge(3000, 1200, RIDGE_X), WEST_WIND, { res: RES });   // an absurd ridge
  for (const v of f.eta) expect(Math.abs(v)).toBeLessThanOrEqual(ETA_MAX);
  expect(Math.max(...Array.from(f.eta))).toBeCloseTo(ETA_MAX, 6);   // and it does reach the clamp
});

test('w and η are a quarter wave out of phase — where the air rises fastest it has risen least', () => {
  // w is the sine of the response, η the cosine. A quarter-wave shift makes them orthogonal
  // over the wave train, which is the robust way to state it: their correlation is ~0 while
  // each correlates perfectly with itself. Run without the clamp, so the phase is visible.
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: RES, etaGain: 10, etaMax: 1e9 });
  const lee = profile(f).filter(p => p.x > RIDGE_X);
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const W = lee.map(p => p.w), E = lee.map(p => p.eta);
  const corr = dot(W, E) / Math.sqrt(dot(W, W) * dot(E, E));
  expect(Math.abs(corr)).toBeLessThan(0.2);   // orthogonal: a quarter wave apart
});

// ---- the rotor under the crests ----

test('rotors roll only under strong crests, thinned and capped', () => {
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: RES });
  const spots = rotorSpots(f);
  expect(spots.length).toBeGreaterThan(0);
  expect(spots.length).toBeLessThanOrEqual(ROTOR_MAX);
  expect(rotorSpots(waveField(G, flat, WEST_WIND, { res: RES }))).toEqual([]);   // no wave, no rotor
  // Every spot sits on the ground it was found over, and grows with its crest.
  for (const s of spots) {
    expect(s.elev).toBeGreaterThan(0);
    expect(s.size).toBeGreaterThanOrEqual(320);
    expect(s.size).toBeLessThanOrEqual(700);
  }
});

test('the cap holds even when a single row is full of crests', () => {
  // A long ridge across the flow puts a strong crest in every column, so one row alone can
  // fill the quota. The cap has to be honoured per spot, not per row.
  const f = waveField(G, ridge(1500, 3000, RIDGE_X), WEST_WIND, { res: RES });
  expect(rotorSpots(f, 1, 5).length).toBe(5);        // thinning off: every node qualifies
  expect(rotorSpots(f, 1, 1).length).toBe(1);
});

test('a weak wave spins no rotor', () => {
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WEST_WIND, { res: RES, amp: 0.01 });
  expect(Math.max(...Array.from(f.w))).toBeLessThan(ROTOR_W);
  expect(rotorSpots(f)).toEqual([]);
});

// ---- the field must say "I could not look", not "there is nothing here" ----

test('unloaded terrain reports zero ready nodes, so the caller knows not to trust the calm', () => {
  const f = waveField(G, () => null, WEST_WIND, { res: RES });
  expect(f.ready).toBe(0);
  expect(f.total).toBe(G.n * G.n);
  expect(Array.from(f.w).every(v => v === 0)).toBe(true);
});
