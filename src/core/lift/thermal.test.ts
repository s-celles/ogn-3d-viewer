// The thermal field is the sun landing on the ground: which facets catch it, which are in
// shadow, how much of the absorbed heat becomes buoyancy, and how deep the air above can
// convect. Every one of those is a claim that can be checked against analytic terrain and an
// analytic sun — a south-facing slope must beat a north-facing one, a peak must shade the
// valley behind it, snow must kill the heating. No app state, no DEM tiles, no renderer.
import { test, expect } from 'bun:test';
import { thermalField, cumulusSpots, snowLineM, diurnalStore, SNOW_MID, SNOW_AMP } from './thermal';
import { thermalBin } from '../liftviz';
import type { NodeGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

const G: NodeGrid = { cLon: 6, cLat: 45, R: 8000, n: 60 };
const mLng = mPerLng(G.cLat);
const east = (lon: number) => (lon - G.cLon) * mLng;
const north = (lat: number) => (lat - G.cLat) * M_PER_LAT;

const flat: ElevSampler = () => 1000;
/** A uniform slope of gradient `gy` = ∂h/∂y. The surface normal is (−gx, −gy, 1), so ground
 *  that RISES northward (gy > 0) is the one whose face looks SOUTH. */
const slope = (gy: number): ElevSampler => (_lon, lat) => 1000 + gy * north(lat);
const SOUTH_FACING = 0.3, NORTH_FACING = -0.3;
/** A tall narrow peak at (x0, 0). */
const peak = (h: number, L: number, x0: number): ElevSampler =>
  (lon, lat) => 1000 + h * Math.exp(-((east(lon) - x0) ** 2 + north(lat) ** 2) / (2 * L * L));

/** Sun high in the south (northern hemisphere noon): east 0, north −0.5, up 0.87. */
const NOON: [number, number, number] = [0, -0.5, Math.sqrt(1 - 0.25)];
/** Sun low in the east, 10° up — long shadows to the west. */
const LOW_EAST: [number, number, number] = [Math.cos(10 * Math.PI / 180), 0, Math.sin(10 * Math.PI / 180)];

const base = {
  dni: 900, diff: 90, convTop: NaN, ziFallback: 1500,
  cal: 1, heatStore: 0, dM: 0, snowLine: 9999, lc: null, street: null,
};
const P = (over: Partial<typeof base> & { sun: [number, number, number] }) => ({ ...base, ...over });

/** Mean Vz over the cells that have one. */
const meanVz = (f: ReturnType<typeof thermalField>) => {
  const v = Array.from(f.vz).filter(x => !Number.isNaN(x));
  return v.reduce((s, x) => s + x, 0) / v.length;
};
/** The cell nearest a point on the ground. */
const at = (f: ReturnType<typeof thermalField>, x: number, y: number) => {
  let best = NaN, bd = Infinity;
  for (let j = 0; j < f.nw; j++) for (let i = 0; i < f.nw; i++) {
    const d = Math.hypot(east(f.lon[i]) - x, north(f.lat[j]) - y);
    if (d < bd) { bd = d; best = f.vz[j * f.nw + i]; }
  }
  return best;
};

// ---- sun on a slope ----

test('a sun-facing slope makes more lift than a shaded one, and flat ground sits between', () => {
  const south = meanVz(thermalField(G, slope(SOUTH_FACING), P({ sun: NOON })));
  const level = meanVz(thermalField(G, flat, P({ sun: NOON })));
  const north0 = meanVz(thermalField(G, slope(NORTH_FACING), P({ sun: NOON })));
  expect(south).toBeGreaterThan(level);
  expect(level).toBeGreaterThan(north0);
});

test('flat ground under the reference sun makes exactly the reference updraught', () => {
  // wRef is defined as what a flat patch of reference ground gets. Flat terrain at the
  // reference elevation must therefore come out at wRef — the yardstick has to be honest.
  const f = thermalField(G, flat, P({ sun: [0, 0, 1] }));   // sun straight up: cosInc = 1
  expect(meanVz(f)).toBeCloseTo(f.wRef, 3);
});

test('no sun, no thermals', () => {
  const f = thermalField(G, slope(SOUTH_FACING), P({ sun: [0, -0.99, 0.0], dni: 0, diff: 0 }));
  for (const v of f.vz) if (!Number.isNaN(v)) expect(v).toBeCloseTo(0, 6);
});

// ---- cast shadows ----

test('a peak shades the ground behind it, away from the sun', () => {
  // Sun low in the east: the peak's shadow falls to the WEST of it.
  const f = thermalField(G, peak(1200, 600, 0), P({ sun: LOW_EAST }));
  const shaded = at(f, -2500, 0);    // west of the peak — in its shadow
  const sunlit = at(f, 2500, 0);     // east of the peak — facing the sun
  expect(shaded).toBeLessThan(sunlit);
});

test('with the sun overhead nothing shades anything', () => {
  const f = thermalField(G, peak(1200, 600, 0), P({ sun: [0, 0, 1] }));
  // Symmetric terrain, symmetric sun → the two flanks heat identically. Only to within the
  // grid's own asymmetry: the lattice has no node exactly on the summit.
  expect(at(f, -2500, 0)).toBeCloseTo(at(f, 2500, 0), 1);
});

// ---- the yardstick ----

test('the reference is the TYPICAL ground in view, not the point under the camera', () => {
  // A lone peak in a plain. Whether the camera happens to sit on the summit or beside it must
  // not change what the map says about the terrain — so the reference is the MEDIAN height of
  // the ground actually loaded, not a single sample. With a single sample this swung the warm
  // fraction from 3% to 41% over the same real terrain, purely from where the view was centred.
  const terrain = peak(1500, 900, 0);
  const onThePeak = thermalField({ ...G, cLon: 6, cLat: 45 }, terrain, P({ sun: [0, 0, 1] }));
  const beside = thermalField({ ...G, cLon: 6.02, cLat: 45 }, terrain, P({ sun: [0, 0, 1] }));
  // The summit is 2500 m; the plain is 1000. A point sample would give one or the other.
  expect(onThePeak.refElev).toBeLessThan(1200);
  expect(beside.refElev).toBeLessThan(1200);
  // And the yardstick barely moves, so the colours mean the same thing in both views.
  expect(beside.wRef).toBeCloseTo(onThePeak.wRef, 2);
});

test('the reference follows the ground when the ground really changes', () => {
  // Not blind to elevation — a high plateau IS a different reference from a valley floor.
  const low = thermalField(G, () => 500, P({ sun: [0, 0, 1], convTop: 3000 }));
  const high = thermalField(G, () => 2200, P({ sun: [0, 0, 1], convTop: 3000 }));
  expect(low.refElev).toBe(500);
  expect(high.refElev).toBe(2200);
  expect(high.wRef).toBeLessThan(low.wRef);   // less depth to convect in up there
});

// ---- the ceiling ----

test('ground poking above the boundary layer grows no thermals at all', () => {
  // convTop is an AMSL ceiling: ground within 100 m of it has no depth left to convect in.
  // A BROAD summit is needed for the hole to survive — see the test below.
  const f = thermalField(G, peak(2000, 2500, 0), P({ sun: [0, 0, 1], convTop: 3050 }));
  expect(Number.isNaN(at(f, 0, 0))).toBe(true);        // the summit (3000 m) — no room above it
  expect(at(f, 7000, 0)).toBeGreaterThan(0);           // the plain (1000 m) — 2 km of depth
});

test('the 3x3 blur fills the ceiling hole over a narrow summit', () => {
  // The blur averages whatever neighbours it can find, so a hole only a cell or two wide is
  // closed by the valid ground around it: a sharp peak above the boundary layer still gets a
  // (weak) value, not a gap. That is the smoothing paying for itself in bin noise, and it is
  // worth knowing about — it is why the ceiling reads as a fade, not a cliff.
  const f = thermalField(G, peak(2000, 700, 0), P({ sun: [0, 0, 1], convTop: 3050 }));
  expect(Array.from(f.vz).every(v => !Number.isNaN(v))).toBe(true);   // no gap at all
  expect(at(f, 0, 0)).toBeLessThan(at(f, 7000, 0));                   // but the summit is still weak
});

test('a deeper boundary layer makes stronger thermals — w* grows as the cube root of z_i', () => {
  const shallow = thermalField(G, flat, P({ sun: [0, 0, 1], ziFallback: 500 }));
  const deep = thermalField(G, flat, P({ sun: [0, 0, 1], ziFallback: 4000 }));
  expect(meanVz(deep) / meanVz(shallow)).toBeCloseTo(Math.cbrt(3500 / 500), 2);   // z_i is capped at 3500
});

// ---- surface properties ----

test('snow shuts the heating down', () => {
  const bare = thermalField(G, peak(2000, 900, 0), P({ sun: [0, 0, 1], snowLine: 9999 }));
  const snowy = thermalField(G, peak(2000, 900, 0), P({ sun: [0, 0, 1], snowLine: 1500 }));
  // Snow takes the albedo from 0.2 to 0.72, so the absorbed flux falls to 0.28/0.8 = 35% of
  // bare ground. But w* is a CUBE ROOT of the flux, so the climb only falls to ∛0.35 ≈ 70%:
  // losing two thirds of the heat costs less than a third of the lift. That non-linearity is
  // the whole reason a marginal day still flies.
  expect(at(snowy, 0, 0) / at(bare, 0, 0)).toBeCloseTo(Math.cbrt(0.28 / 0.8), 2);
  expect(at(snowy, 7000, 0)).toBeCloseTo(at(bare, 7000, 0), 6); // the plain, below the line, is untouched
});

test('the seasonal snow line is highest in late July and lowest in midwinter', () => {
  const july = snowLineM(Date.parse('2024-07-20T12:00:00Z'), 45);
  const january = snowLineM(Date.parse('2024-01-20T12:00:00Z'), 45);
  expect(july).toBeCloseTo(SNOW_MID + SNOW_AMP, -1.6);
  expect(january).toBeCloseTo(SNOW_MID - SNOW_AMP, -1.6);
  // South of the equator the seasons are the other way round.
  expect(snowLineM(Date.parse('2024-01-20T12:00:00Z'), -45)).toBeGreaterThan(january);
});

// ---- the diurnal reservoir ----

test('the ground charges in the morning and gives back in the late afternoon', () => {
  const day = (h: number) => diurnalStore(Date.parse(`2024-06-21T${String(h).padStart(2, '0')}:00:00Z`), 45, 0);
  expect(day(8)).toBeLessThan(0);      // morning: the ground is absorbing, thermals lag
  expect(day(16)).toBeGreaterThan(0);  // late afternoon: it is releasing, thermals linger
});

test('the polar night has no diurnal cycle to speak of', () => {
  expect(diurnalStore(Date.parse('2024-12-21T12:00:00Z'), 85, 0)).toBe(0);
});

test('heat storage boosts the afternoon and damps the morning', () => {
  const sun: [number, number, number] = [0, 0, 1];
  const off = thermalField(G, flat, P({ sun, heatStore: 0, dM: 0.5 }));
  const on = thermalField(G, flat, P({ sun, heatStore: 1, dM: 0.5 }));    // afternoon: releasing
  const morn = thermalField(G, flat, P({ sun, heatStore: 1, dM: -0.5 })); // morning: charging
  expect(meanVz(on)).toBeGreaterThan(meanVz(off));
  expect(meanVz(morn)).toBeLessThan(meanVz(off));
});

// ---- reading the field ----

test('the colour scale reads the ANOMALY: warm above flat ground, blue below, nothing between', () => {
  const wRef = 1.0, scaleRef = 1.0;
  expect(thermalBin(1.02, wRef, scaleRef)).toBeNull();   // 2% better than flat — unremarkable
  expect(thermalBin(0.90, wRef, scaleRef)).toBeNull();   // 10% worse — still unremarkable
  expect(thermalBin(1.05, wRef, scaleRef)).toBe(0);      // +5% → the faintest warm
  expect(thermalBin(1.30, wRef, scaleRef)).toBe(4);      // +30% → full red: exceptional ground
  expect(thermalBin(0.78, wRef, scaleRef)).toBe(5);      // −22% → first blue
  expect(thermalBin(0.50, wRef, scaleRef)).toBe(7);      // −50% → darkest blue
});

test('the colour scale survives calibration — that is the whole reason it is an anomaly', () => {
  // liftCalibration multiplies the field by up to 3.5 to match the day's real climbs. An
  // ABSOLUTE scale cannot survive that: calibrate a good day and every cell shoots past full
  // red. The anomaly is invariant, because cal scales vz and wRef alike.
  for (const cal of [1, 2, 3.5]) {
    expect(thermalBin(1.30 * cal, 1.0 * cal, 1.0 * cal)).toBe(4);
    expect(thermalBin(1.02 * cal, 1.0 * cal, 1.0 * cal)).toBeNull();
    expect(thermalBin(0.50 * cal, 1.0 * cal, 1.0 * cal)).toBe(7);
  }
});

// ---- cumulus ----

test('cumulus mark the strong cores, drift downwind, and never sit below the ground', () => {
  const f = thermalField(G, peak(600, 900, 0), P({ sun: [0.4, 0, 0.9] }));
  const ref = { wRef: f.wRef, scaleRef: f.scaleRef };
  const still = cumulusSpots(f, { cloudbase: 2200, drift: null, ...ref });
  expect(still.length).toBeGreaterThan(0);
  const blown = cumulusSpots(f, { cloudbase: 2200, drift: [10, 0], ...ref });
  // The same cores, but carried east while the parcel climbs to the base.
  expect(blown.length).toBe(still.length);
  expect(east(blown[0].lon)).toBeGreaterThan(east(still[0].lon));
  // A cloudbase under the summit puts no cloud on the summit.
  expect(cumulusSpots(f, { cloudbase: 1200, drift: null, ...ref }).every(s => s.base >= 1200)).toBe(true);
});

test('featureless ground grows no cumulus — a cloud marks a core, not a day', () => {
  // Flat ground IS the reference, so its anomaly is zero everywhere: no core stands out, and no
  // cloud is drawn. However hot the day.
  const f = thermalField(G, flat, P({ sun: [0, 0, 1], dni: 1000 }));
  expect(cumulusSpots(f, { cloudbase: 2200, drift: null, wRef: f.wRef, scaleRef: f.scaleRef })).toEqual([]);
});

// ---- the field must say "I could not look", not "there is nothing here" ----

test('unloaded terrain reports zero ready nodes', () => {
  const f = thermalField(G, () => null, P({ sun: NOON }));
  expect(f.ready).toBe(0);
  expect(f.total).toBe(G.n * G.n);
  expect(Array.from(f.vz).every(Number.isNaN)).toBe(true);
});
