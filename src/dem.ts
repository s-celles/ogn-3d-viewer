// ============ global elevation sampler from the Terrarium DEM tiles ============
// Sample ground elevation anywhere from the same Terrarium tiles the terrain uses
// (AWS CDN, no API rate limit), decoded in pure JS with UPNG. Tiles are cached, so a
// cluster of nearby sample points costs one fetch. Used by the wave scan to measure a
// site's relief without hammering a metered elevation API.
import UPNG from 'upng-js';
import { TERRAIN } from './config';

const Z = 11;                       // zoom (~20 km tile, ~76 m pixel) — fine enough for relief
type Tile = { rgba: Uint8Array; w: number } | null;
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
    return { rgba: new Uint8Array(UPNG.toRGBA8(img)[0]), w: img.width } as Tile;
  }).catch(() => null).then(t => { tiles.set(key, t); inflight.delete(key); return t; });
  inflight.set(key, p); return p;
}

/** Ground elevation (m) at lon/lat from the Terrarium DEM, or null if the tile fails. */
export async function demElev(lon: number, lat: number): Promise<number | null> {
  const n = 2 ** Z, la = lat * Math.PI / 180;
  const xf = (lon + 180) / 360 * n;
  const yf = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
  const x = ((Math.floor(xf) % n) + n) % n, y = Math.max(0, Math.min(n - 1, Math.floor(yf)));
  const t = await fetchTile(x, y); if (!t) return null;
  const px = Math.max(0, Math.min(t.w - 1, Math.floor((xf - Math.floor(xf)) * t.w)));
  const py = Math.max(0, Math.min(t.w - 1, Math.floor((yf - Math.floor(yf)) * t.w)));
  const i = (py * t.w + px) * 4;
  return t.rgba[i] * 256 + t.rgba[i + 1] + t.rgba[i + 2] / 256 - 32768;
}
