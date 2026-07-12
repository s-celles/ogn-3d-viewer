// ============ global elevation sampler from the Terrarium DEM tiles ============
// Sample ground elevation anywhere from the same Terrarium tiles the terrain uses
// (AWS CDN, no API rate limit), decoded in pure JS with UPNG. Tiles are cached, so a
// cluster of nearby sample points costs one fetch. Used by the wave scan to measure a
// site's relief without hammering a metered elevation API.
// The tile maths and the Terrarium codec live in core/geo.ts; this only fetches.
import UPNG from 'upng-js';
import { TERRAIN } from './config';
import { lonLatToTile, elevAtFromTiles, type ElevTile } from './core/geo';

const Z = 11;                       // zoom (~20 km tile, ~76 m pixel) — fine enough for relief
type Tile = ElevTile | null;
const tiles = new Map<string, Tile>();
const inflight = new Map<string, Promise<Tile>>();

function fetchTile(x: number, y: number): Promise<Tile> {
  const key = `${x}/${y}`;
  if (tiles.has(key)) return Promise.resolve(tiles.get(key)!);
  const ex = inflight.get(key); if (ex) return ex;
  const url = TERRAIN.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y));
  const p = fetch(url).then(async r => {
    if (!r.ok) return null;
    const img = UPNG.decode(await r.arrayBuffer());
    return { rgba: new Uint8Array(UPNG.toRGBA8(img)[0]), w: img.width, h: img.height } as Tile;
  }).catch(() => null).then(t => { tiles.set(key, t); inflight.delete(key); return t; });
  inflight.set(key, p); return p;
}

/** Ground elevation (m) at lon/lat from the Terrarium DEM, or null if the tile fails. */
export async function demElev(lon: number, lat: number): Promise<number | null> {
  const n = 2 ** Z, { xf, yf } = lonLatToTile(lon, lat, Z);
  const x = ((Math.floor(xf) % n) + n) % n, y = Math.max(0, Math.min(n - 1, Math.floor(yf)));
  await fetchTile(x, y);   // ensure the covering tile is in the store, then sample it
  // Wrap/clamp in the lookup too, so a point on the anti-meridian finds its tile.
  const get = (_z: number, tx: number, ty: number): Tile => {
    const wx = ((tx % n) + n) % n, cy = Math.max(0, Math.min(n - 1, ty));
    return tiles.get(`${wx}/${cy}`) ?? null;
  };
  return elevAtFromTiles(lon, lat, get, Z, Z);
}
