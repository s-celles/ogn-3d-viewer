// Convergence is the *curvature* of the terrain-deflected flow, not its gradient: the wind
// piles up where concave ground funnels it together (valley heads, bowls) and spreads out
// around convex ground. These tests pin it to analytic terrain where the sign follows from
// that alone — a bowl must converge, a hill must diverge, and the two must mirror each
// other exactly. No app state, no DEM tiles, no renderer.
import { test, expect } from 'bun:test';
import { convergField, convergActive } from './converg';
import type { NodeGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler } from '../ports';

const G: NodeGrid = { cLon: 6, cLat: 45, R: 4000, n: 48 };
const mLng = mPerLng(G.cLat);
const east = (lon: number) => (lon - G.cLon) * mLng;
const north = (lat: number) => (lat - G.cLat) * M_PER_LAT;

const flat: ElevSampler = () => 1000;
/** A smooth Gaussian bump at the grid centre: h > 0 a hill (convex), h < 0 a bowl (concave). */
const gauss = (h: number, L: number): ElevSampler =>
  (lon, lat) => 1000 + h * Math.exp(-(east(lon) ** 2 + north(lat) ** 2) / (2 * L * L));

const WEST_WIND = [8, 0] as const;   // blowing towards the east
const noSun = { insol: 0, water: null };
const HILL = gauss(400, 900), BOWL = gauss(-400, 900);

/** Net convergence over the field: > 0 the flow piles up on balance, < 0 it spreads out. */
const net = (cells: { c: number }[]) => cells.reduce((s, c) => s + c.c, 0);
/** The cell within `tol` metres of a point — null if the field has nothing there, so a
 *  missing cell fails the test instead of silently standing in for a distant one. */
const at = (cells: { lon: number; lat: number; c: number }[], x: number, y: number, tol = 250) => {
  let best = null, bd = tol;
  for (const c of cells) {
    const d = Math.hypot(east(c.lon) - x, north(c.lat) - y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
};

test('a uniform wind over flat ground converges nowhere', () => {
  const f = convergField(G, flat, WEST_WIND, noSun);
  expect(f.ready).toBeGreaterThan(0);   // the ground IS loaded — there is simply no curvature
  expect(f.cells).toEqual([]);
});

test('a bowl converges the flow; a hill diverges it around itself', () => {
  const bowl = convergField(G, BOWL, WEST_WIND, noSun);
  const hill = convergField(G, HILL, WEST_WIND, noSun);
  expect(bowl.cells.length).toBeGreaterThan(50);
  expect(net(bowl.cells)).toBeGreaterThan(0);   // concave ground funnels the flow together
  expect(net(hill.cells)).toBeLessThan(0);      // convex ground splits it
});

test('inverting the terrain inverts the field exactly', () => {
  // A bowl is a hill turned inside out, and the deflection is linear in the gradient: the
  // two fields must be mirror images, cell for cell.
  const bowl = convergField(G, BOWL, WEST_WIND, noSun);
  const hill = convergField(G, HILL, WEST_WIND, noSun);
  expect(bowl.cells.length).toBe(hill.cells.length);
  expect(net(bowl.cells)).toBeCloseTo(-net(hill.cells), 6);
});

test('the field is normalised: its value does not depend on the wind speed', () => {
  // It is a *fraction of the wind lost per cell*, dimensionless — so it can be compared
  // across a calm day and a windy one, and across zoom levels. Doubling the wind doubles
  // the divergence and the normaliser alike.
  const slow = convergField(G, BOWL, [3, 0], noSun);
  const fast = convergField(G, BOWL, [12, 0], noSun);
  expect(slow.cells.length).toBe(fast.cells.length);
  expect(net(slow.cells)).toBeCloseTo(net(fast.cells), 6);
});

test('reversing the wind mirrors the field about the terrain', () => {
  const east0 = convergField(G, BOWL, [8, 0], noSun);
  const west0 = convergField(G, BOWL, [-8, 0], noSun);
  const a = at(east0.cells, 255, -85), b = at(west0.cells, -255, -85);
  expect(a).not.toBeNull();
  expect(b!.c).toBeCloseTo(a!.c, 6);
});

// ---- lake breeze ----

/** Sensible-heat fraction per node: water (0) west of the shore, land (1) east of it. */
const shoreline = (g: NodeGrid): Float32Array => {
  const sens = new Float32Array(g.n * g.n), sp = 2 * g.R / (g.n - 1);
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) sens[j * g.n + i] = (-g.R + i * sp) < 0 ? 0 : 1;
  return sens;
};

test('a sunny shoreline lifts just inland and sinks over the water, with no wind at all', () => {
  const f = convergField(G, flat, [0, 0], { insol: 1, water: shoreline(G) });
  expect(f.cells.length).toBeGreaterThan(0);
  // The breeze does not converge *at* the shore but ~a blur-width inland (LB_BLUR cells,
  // ~850 m here): the curvature of a smoothed step is zero at the step and peaks at its edges.
  const inland = at(f.cells, 900, 0), offshore = at(f.cells, -900, 0);
  expect(inland!.c).toBeGreaterThan(0);     // the breeze converges on the land side of the shore
  expect(offshore!.c).toBeLessThan(0);      // and subsides over the cool water
});

test('a strong synoptic wind washes the lake breeze out', () => {
  // Below the drawing threshold the blown-out breeze would vanish entirely, so look under
  // it: the point is that the value collapses, not merely that it stops being drawn.
  const p = { insol: 1, water: shoreline(G), convMin: 0.001 };
  const calm = convergField(G, flat, [0, 0], p);
  const blown = convergField(G, flat, [12, 0], p);
  expect(at(blown.cells, 900, 0)!.c).toBeLessThan(at(calm.cells, 900, 0)!.c);
  expect(at(blown.cells, 900, 0)!.c).toBeGreaterThan(0);   // damped to a fifth, not reversed
});

test('no sun means no breeze, whatever the shoreline', () => {
  const f = convergField(G, flat, [0, 0], { insol: 0, water: shoreline(G) });
  expect(f.cells).toEqual([]);
});

// ---- the field must say "I could not look", not "there is nothing here" ----

test('calm and dark with no water is not a field at all', () => {
  expect(convergActive([0.2, 0], false)).toBe(false);
  expect(convergActive([8, 0], false)).toBe(true);     // wind alone is enough
  expect(convergActive([0.2, 0], true)).toBe(true);    // so is a shoreline
});

test('unloaded terrain reports zero ready nodes, so the caller knows not to trust the emptiness', () => {
  const f = convergField(G, () => null, WEST_WIND, noSun);
  expect(f.cells).toEqual([]);
  expect(f.ready).toBe(0);
  expect(f.total).toBe(G.n * G.n);
});
