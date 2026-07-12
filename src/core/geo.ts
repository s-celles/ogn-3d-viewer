// ============ geodesy, web-mercator tiles and the Terrarium elevation codec ======
// The ground, as numbers: where a lon/lat falls in the tile pyramid, what a tile
// covers, how an elevation is encoded in an RGB pixel, and how to read a height
// out of whatever tiles are currently held.
//
// Deliberately storage-agnostic: nothing here fetches a tile or knows a cache.
// `elevAtFromTiles` takes a *lookup function* — so the same sampler serves a
// browser streaming tiles from a CDN and a flight computer reading a DEM out of a
// pre-flight data pack, with no network at all.

/** A DEM tile decoded to Terrarium-encoded RGBA + its dimensions. */
export interface ElevTile { rgba: Uint8Array; w: number; h: number }
/** Geographic bounding box of a tile. */
export interface BBox { west: number; east: number; north: number; south: number }

export const MERC = 20037508.342789244;   // half the EPSG:3857 world span (m)
export const M_PER_LAT = 111320;          // metres per degree of latitude

/** Metres per degree of longitude at a latitude (they shrink toward the poles). */
export const mPerLng = (lat: number): number => M_PER_LAT * Math.cos(lat * Math.PI / 180);

/** Fractional tile coordinates of a lon/lat at a zoom: the integer parts are the tile
 *  index, the fractions the position inside it (x east, y south). */
export function lonLatToTile(lon: number, lat: number, z: number): { xf: number; yf: number } {
  const n = 2 ** z, latR = lat * Math.PI / 180;
  return {
    xf: (lon + 180) / 360 * n,
    yf: (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n,
  };
}

/** Geographic bounding box of a web-mercator tile. */
export function tileBBox(x: number, y: number, z: number): BBox {
  const n = 2 ** z;
  const lng = (xx: number) => xx / n * 360 - 180;
  const lat = (yy: number) => { const m = Math.PI * (1 - 2 * yy / n); return 180 / Math.PI * Math.atan(Math.sinh(m)); };
  return { west: lng(x), east: lng(x + 1), north: lat(y), south: lat(y + 1) };
}

/** A tile's extent in EPSG:3857 metres: [minx, miny, maxx, maxy] (WMS bbox order). */
export function tile3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (MERC * 2) / 2 ** z, minx = -MERC + x * size, maxy = MERC - y * size;
  return [minx, maxy - size, minx + size, maxy];
}

/** Elevation (m) from a Terrarium RGB pixel: R·256 + G + B/256 − 32768. */
export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** Elevation (m) at an integer pixel of a Terrarium tile. */
export function sampleTerrarium(t: ElevTile, px: number, py: number): number {
  const i = (py * t.w + px) * 4;
  return decodeTerrarium(t.rgba[i], t.rgba[i + 1], t.rgba[i + 2]);
}

/** Elevation (m) at a fractional pixel, bilinearly interpolated and clamped to the
 *  tile. Nearest-neighbour beats against a mesh grid and shows as corrugations on a
 *  sharp DEM, so we always interpolate the four neighbours. */
export function sampleTerrainBilinear(t: ElevTile, fx: number, fy: number): number {
  fx = Math.max(0, Math.min(t.w - 1, fx)); fy = Math.max(0, Math.min(t.h - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = sampleTerrarium(t, x0, y0) * (1 - tx) + sampleTerrarium(t, x1, y0) * tx;
  const b = sampleTerrarium(t, x0, y1) * (1 - tx) + sampleTerrarium(t, x1, y1) * tx;
  return a * (1 - ty) + b * ty;
}

/** Encode an N×N elevation grid (m) into a Terrarium RGBA tile, so every DEM source
 *  (Terrarium PNG, a national float DEM, a data pack) reads back through one path.
 *  Nodata pixels (≤ −9000, the usual sentinel) take the coarser `fallback` tile —
 *  or sea level when there is none, which is a flat spot rather than a pit. */
export function encodeTerrarium(elev: ArrayLike<number>, N: number, fallback: ElevTile | null): ElevTile {
  const rgba = new Uint8Array(N * N * 4);
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const i = py * N + px;
    let e = elev[i];
    if (!(e > -9000)) {
      if (fallback) {
        const fx = Math.min(fallback.w - 1, Math.floor(px / N * fallback.w));
        const fy = Math.min(fallback.h - 1, Math.floor(py / N * fallback.h));
        e = sampleTerrarium(fallback, fx, fy);
      } else e = 0;
    }
    const v = e + 32768, R = Math.max(0, Math.min(255, Math.floor(v / 256)));
    const rem = v - R * 256, G = Math.max(0, Math.min(255, Math.floor(rem)));
    const B = Math.max(0, Math.min(255, Math.floor((rem - G) * 256)));
    const o = i * 4; rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
  }
  return { rgba, w: N, h: N };
}

/** Look up a tile of the pyramid; null when it is not held. */
export type TileLookup = (z: number, x: number, y: number) => ElevTile | null;

/** Ground elevation (m) at a lon/lat, read from the finest tile available: walk the
 *  pyramid down from `zMax` to `zMin` and take the first tile that covers the point.
 *  Null when nothing covering it is held — an *unknown* height, never a fake zero. */
export function elevAtFromTiles(lon: number, lat: number, get: TileLookup, zMax: number, zMin: number): number | null {
  for (let z = zMax; z >= zMin; z--) {
    const { xf, yf } = lonLatToTile(lon, lat, z);
    const x = Math.floor(xf), y = Math.floor(yf);
    const t = get(z, x, y);
    if (!t) continue;
    const px = Math.min(t.w - 1, Math.max(0, Math.floor((xf - x) * t.w)));
    const py = Math.min(t.h - 1, Math.max(0, Math.floor((yf - y) * t.h)));
    return sampleTerrarium(t, px, py);
  }
  return null;
}
