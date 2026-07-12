import { test, expect } from 'bun:test';
import {
  lonLatToTile, tileBBox, tile3857, mPerLng, M_PER_LAT,
  decodeTerrarium, sampleTerrarium, sampleTerrainBilinear, encodeTerrarium,
  elevAtFromTiles, type ElevTile,
} from './geo';

/** A 2×2 Terrarium tile with the four given elevations (row-major, north row first). */
const tile = (e: number[]): ElevTile => {
  const rgba = new Uint8Array(16);
  e.forEach((m, i) => {
    const v = m + 32768, R = Math.floor(v / 256), rem = v - R * 256, G = Math.floor(rem);
    rgba.set([R, G, Math.floor((rem - G) * 256), 255], i * 4);
  });
  return { rgba, w: 2, h: 2 };
};

test('lonLatToTile: the null island sits at the centre of the world at z=1', () => {
  const t = lonLatToTile(0, 0, 1);
  expect(t.xf).toBeCloseTo(1, 6);
  expect(t.yf).toBeCloseTo(1, 6);
  // the anti-meridian and the mercator poles are the corners
  expect(lonLatToTile(-180, 0, 1).xf).toBeCloseTo(0, 6);
  expect(lonLatToTile(180, 0, 1).xf).toBeCloseTo(2, 6);
  expect(lonLatToTile(0, 85.0511, 1).yf).toBeCloseTo(0, 3);
});

test('tileBBox is the inverse of lonLatToTile', () => {
  const z = 11, lon = 6.1, lat = 45.3;
  const { xf, yf } = lonLatToTile(lon, lat, z);
  const bb = tileBBox(Math.floor(xf), Math.floor(yf), z);
  expect(lon).toBeGreaterThanOrEqual(bb.west);
  expect(lon).toBeLessThanOrEqual(bb.east);
  expect(lat).toBeLessThanOrEqual(bb.north);
  expect(lat).toBeGreaterThanOrEqual(bb.south);
  expect(bb.north).toBeGreaterThan(bb.south);
});

test('tile3857: the whole world at z=0, quadrants at z=1', () => {
  const M = 20037508.342789244;
  expect(tile3857(0, 0, 0)).toEqual([-M, -M, M, M]);
  const [minx, miny, maxx, maxy] = tile3857(1, 0, 0);   // north-west quadrant
  expect(minx).toBeCloseTo(-M, 3);
  expect(maxx).toBeCloseTo(0, 3);
  expect(maxy).toBeCloseTo(M, 3);
  expect(miny).toBeCloseTo(0, 3);
});

test('metres per degree: latitude is constant, longitude shrinks toward the poles', () => {
  expect(M_PER_LAT).toBeCloseTo(111320, 0);
  expect(mPerLng(0)).toBeCloseTo(111320, 0);
  expect(mPerLng(60)).toBeCloseTo(111320 / 2, 0);
  expect(mPerLng(90)).toBeCloseTo(0, 3);
});

test('Terrarium codec: encode → decode round-trips an elevation grid (incl. below sea level)', () => {
  const elev = new Float32Array([0, 1234.5, 4807, -412]);
  const t = encodeTerrarium(elev, 2, null);
  for (let i = 0; i < 4; i++)
    expect(sampleTerrarium(t, i % 2, i >> 1)).toBeCloseTo(elev[i], 2);   // 1/256 m quantisation
});

test('encodeTerrarium: nodata pixels fall back to the coarser tile, or to 0 without one', () => {
  const fallback = tile([100, 200, 300, 400]);
  const elev = new Float32Array([-99999, 50, -99999, 60]);
  const merged = encodeTerrarium(elev, 2, fallback);
  expect(sampleTerrarium(merged, 0, 0)).toBeCloseTo(100, 1);   // nodata → fallback
  expect(sampleTerrarium(merged, 1, 0)).toBeCloseTo(50, 1);    // real value kept
  expect(sampleTerrarium(merged, 0, 1)).toBeCloseTo(300, 1);
  const alone = encodeTerrarium(elev, 2, null);
  expect(sampleTerrarium(alone, 0, 0)).toBeCloseTo(0, 1);      // no fallback → sea level, not a pit
});

test('decodeTerrarium reads the RGB elevation encoding', () => {
  // R*256 + G + B/256 - 32768
  expect(decodeTerrarium(128, 0, 0)).toBeCloseTo(0, 6);
  expect(decodeTerrarium(128, 100, 128)).toBeCloseTo(100.5, 6);
  expect(decodeTerrarium(127, 156, 0)).toBeCloseTo(-100, 6);
});

test('sampleTerrainBilinear interpolates between pixels and clamps at the edges', () => {
  const t = tile([0, 100, 200, 300]);         // NW 0, NE 100, SW 200, SE 300
  expect(sampleTerrainBilinear(t, 0, 0)).toBeCloseTo(0, 2);
  expect(sampleTerrainBilinear(t, 1, 1)).toBeCloseTo(300, 2);
  expect(sampleTerrainBilinear(t, 0.5, 0.5)).toBeCloseTo(150, 2);   // centre = mean of the four
  expect(sampleTerrainBilinear(t, 0.5, 0)).toBeCloseTo(50, 2);
  expect(sampleTerrainBilinear(t, -5, 99)).toBeCloseTo(200, 2);     // clamped to the SW corner
});

test('elevAtFromTiles picks the finest tile available and falls back to coarser ones', () => {
  const fine = tile([1000, 1000, 1000, 1000]);
  const coarse = tile([500, 500, 500, 500]);
  const lon = 6.1, lat = 45.3;
  const key = (z: number) => {
    const { xf, yf } = lonLatToTile(lon, lat, z);
    return `${z}/${Math.floor(xf)}/${Math.floor(yf)}`;
  };
  const store = new Map<string, ElevTile>([[key(12), fine], [key(8), coarse]]);
  const get = (z: number, x: number, y: number) => store.get(`${z}/${x}/${y}`) ?? null;

  expect(elevAtFromTiles(lon, lat, get, 15, 7)).toBeCloseTo(1000, 1);   // z12 wins over z8
  store.delete(key(12));
  expect(elevAtFromTiles(lon, lat, get, 15, 7)).toBeCloseTo(500, 1);    // now only the coarse one
  store.clear();
  expect(elevAtFromTiles(lon, lat, get, 15, 7)).toBeNull();             // nothing loaded → unknown
});
