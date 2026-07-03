// ============ terrain: decode terrarium tiles in pure JS (UPNG) and build the mesh ourselves ============
// deck.gl's TerrainLayer decodes terrarium tiles in a Web Worker whose
// createImageBitmap mangles the RGB-encoded elevation (visible as random spikes)
// when the page is served over http. We bypass that pipeline entirely and decode
// with UPNG (a pure-JS PNG decoder) on the main thread.
import UPNG from 'upng-js';
import { S } from './state';
import { TERRAIN, TEXTURE, TERRAIN_N, DECK_CACHE, ELEV_CACHE, DEM_MAXZOOM } from './config';
import { TileLayer, SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import type { DecodedTile } from './types';

interface BBox { west: number; east: number; north: number; south: number; }

/** Geographic bounding box of a web-mercator tile. */
export function tileBBox(x: number, y: number, z: number): BBox {
  const n = 2 ** z;
  const lng = (xx: number) => xx / n * 360 - 180;
  const lat = (yy: number) => { const m = Math.PI * (1 - 2 * yy / n); return 180 / Math.PI * Math.atan(Math.sinh(m)); };
  return { west: lng(x), east: lng(x + 1), north: lat(y), south: lat(y + 1) };
}

/** Build a textured, lit mesh (positions/normals/texCoords) from a decoded tile.
 * (su0, sv0, sf) select the sub-window of the DEM this mesh covers: su0/sv0 are
 * the west/north fractions [0..1] and sf the side length. For a tile at the DEM's
 * own zoom this is the whole tile (0,0,1); for an OVERZOOMED tile (imagery zoom >
 * DEM zoom) it's the fraction of the coarser ancestor DEM under this finer tile,
 * so the photo-res imagery drapes over the (interpolated) coarser elevation. */
export function buildTerrainMesh(t: DecodedTile, west: number, south: number, east: number, north: number,
                                 su0 = 0, sv0 = 0, sf = 1) {
  const { rgba, w, h } = t, cols = TERRAIN_N, rows = TERRAIN_N, k = S.exo;
  const positions: number[] = [], normals: number[] = [], texCoords: number[] = [], indices: number[] = [];
  const heights = new Float32Array(cols * rows);
  const mPerLat = 111320, mPerLng = 111320 * Math.cos((south + north) / 2 * Math.PI / 180);
  const elevAt = (px: number, py: number) => { const i = (py * w + px) * 4; return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1);
    const px = Math.min(w - 1, Math.max(0, Math.round((su0 + u * sf) * (w - 1))));
    const py = Math.min(h - 1, Math.max(0, Math.round((sv0 + (1 - v) * sf) * (h - 1))));
    const e = elevAt(px, py), idx = r * cols + c;
    heights[idx] = e;
    positions.push(west + (east - west) * u, south + (north - south) * v, e * k);
    texCoords.push(u, 1 - v);
  }
  const dx = (east - west) * mPerLng / (cols - 1), dy = (north - south) * mPerLat / (rows - 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const hL = heights[r * cols + Math.max(0, c - 1)], hR = heights[r * cols + Math.min(cols - 1, c + 1)];
    const hD = heights[Math.max(0, r - 1) * cols + c], hU = heights[Math.min(rows - 1, r + 1) * cols + c];
    let nx = -(hR - hL) * k / (2 * dx), ny = -(hU - hD) * k / (2 * dy), nz = 1; const L = Math.hypot(nx, ny, nz) || 1;
    normals.push(nx / L, ny / L, nz / L);
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    indices.push(a, d, b, b, d, e);
  }
  // Skirt: a short vertical wall hanging below each border edge. Adjacent tiles
  // don't share exact edge elevations, which would show as hairline cracks; the
  // higher tile's skirt drops past the lower neighbour's edge and fills the gap.
  // Kept small (cracks between same-LOD tiles are only a few tens of metres) so
  // it isn't a visible curtain in the oblique cockpit/chase views. Scales with k.
  const SKIRT = 30 * k;
  const drop = (gi: number): number => {
    const ni = positions.length / 3;
    positions.push(positions[gi * 3], positions[gi * 3 + 1], positions[gi * 3 + 2] - SKIRT);
    normals.push(normals[gi * 3], normals[gi * 3 + 1], normals[gi * 3 + 2]);
    texCoords.push(texCoords[gi * 2], texCoords[gi * 2 + 1]);
    return ni;
  };
  const border = (seq: number[]) => {
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1], sa = drop(a), sb = drop(b);
      indices.push(a, b, sb, a, sb, sa, a, sb, b, a, sa, sb);   // double-sided (cull-agnostic)
    }
  };
  const top: number[] = [], bot: number[] = [], left: number[] = [], right: number[] = [];
  for (let c = 0; c < cols; c++) { top.push(c); bot.push((rows - 1) * cols + c); }
  for (let r = 0; r < rows; r++) { left.push(r * cols); right.push(r * cols + cols - 1); }
  border(top); border(bot); border(left); border(right);
  return {
    attributes: {
      POSITION: { value: new Float32Array(positions), size: 3 },
      NORMAL: { value: new Float32Array(normals), size: 3 },
      TEXCOORD_0: { value: new Float32Array(texCoords), size: 2 },
    },
    indices: { value: new Uint32Array(indices), size: 1 }, mode: 4,
  };
}

// Decoded-tile elevation cache, populated as tiles stream in (see getTileData).
// Lets us look up the ground elevation under any lng/lat that is currently
// loaded — without any extra network — to keep aircraft from rendering below
// the (coarse) terrain in steep mountains. FIFO-bounded.
interface CachedTile { rgba: Uint8Array; w: number; h: number; }
const TILE_CACHE = new Map<string, CachedTile>();
function cacheTile(z: number, x: number, y: number, t: CachedTile): void {
  TILE_CACHE.set(z + '/' + x + '/' + y, t);
  if (TILE_CACHE.size > ELEV_CACHE) TILE_CACHE.delete(TILE_CACHE.keys().next().value as string);
}

// Fetch + decode one Terrarium DEM tile, reusing the cache (many overzoomed
// imagery tiles share the same coarser ancestor DEM, so this fetches it once).
// Retries transient failures with backoff; gives up quietly once aborted.
async function fetchDEM(z: number, x: number, y: number, signal: AbortSignal): Promise<DecodedTile | null> {
  const hit = TILE_CACHE.get(z + '/' + x + '/' + y);
  if (hit) return hit;
  const url = TERRAIN.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error('http ' + r.status);
      const img = UPNG.decode(await r.arrayBuffer());
      const dec = { rgba: new Uint8Array(UPNG.toRGBA8(img)[0]), w: img.width, h: img.height };
      cacheTile(z, x, y, dec);
      return dec;
    } catch (e) {
      if (signal?.aborted) return null;
      await new Promise(res => setTimeout(res, 200 * (attempt + 1)));
    }
  }
  return null;
}

// Ground elevation (m, orthometric) at a lng/lat from the highest-resolution
// loaded tile covering it, or null if no covering tile is currently cached.
export function terrainElevAt(lon: number, lat: number): number | null {
  for (let z = DEM_MAXZOOM; z >= 7; z--) {
    const n = 2 ** z, xf = (lon + 180) / 360 * n, latR = lat * Math.PI / 180;
    const yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
    const x = Math.floor(xf), y = Math.floor(yf), tile = TILE_CACHE.get(z + '/' + x + '/' + y);
    if (!tile) continue;
    const px = Math.min(tile.w - 1, Math.max(0, Math.floor((xf - x) * tile.w)));
    const py = Math.min(tile.h - 1, Math.max(0, Math.floor((yf - y) * tile.h)));
    const i = (py * tile.w + px) * 4;
    return tile.rgba[i] * 256 + tile.rgba[i + 1] + tile.rgba[i + 2] / 256 - 32768;
  }
  return null;
}

const TERRAIN_ANCHOR = [{}];

/** Build the streaming terrain TileLayer (rebuilt whenever exaggeration changes). */
export function makeTerrain() {
  return new TileLayer({
    // maxZoom = the ground-detail setting. Up to the DEM ceiling (15) each tile
    // is a normal DEM tile textured with its own Esri image; BEYOND 15 the tile
    // takes its DEM elevation from the coarser z15 ancestor while still fetching
    // full-resolution Esri imagery at its own zoom — so the photo keeps sharpening.
    id: 'terrain', data: TERRAIN, minZoom: 0, maxZoom: S.groundZoom, tileSize: 256, maxCacheSize: DECK_CACHE,
    // In first-person/chase the tilted frustum sees a wide swathe to the horizon,
    // so many tiles are in flight at once. The default 6 concurrent requests drain
    // the queue too slowly (background stays blurry/holey); raise it. 'best-available'
    // keeps a coarse ancestor tile drawn while its children load, so gaps read as
    // blur that sharpens rather than sky showing through the ground.
    maxRequests: 12, refinementStrategy: 'best-available',
    // Elevation band (metres, scaled by the exaggeration like the mesh z) used to
    // build each tile's 3D bounding box for frustum culling. Without it deck
    // assumes tiles sit at sea level (z=0); in first-person/chase the camera flies
    // ABOVE the terrain, so the z=0 tile boxes fall below the view frustum and get
    // culled → the foreground terrain never loads (holes). Bracketing the real
    // terrain altitude keeps those tiles in view.
    zRange: [0, 4500 * S.exo],
    getTileData: async (tile: any): Promise<DecodedTile | null> => {
      const { x, y, z } = tile.index || tile;
      // Take the DEM from this tile's zoom, or — when overzoomed past the DEM
      // ceiling — from its z15 ancestor (cached, so siblings share one fetch).
      const dz = Math.max(0, z - DEM_MAXZOOM);
      return fetchDEM(z - dz, x >> dz, y >> dz, tile.signal);
    },
    renderSubLayers: (props: any) => {
      const t = props.data as DecodedTile | null; if (!t) return null;
      const { x, y, z } = props.tile.index, bb = tileBBox(x, y, z);
      const turl = TEXTURE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      // Which fraction of the (possibly coarser) ancestor DEM this tile covers.
      const dz = Math.max(0, z - DEM_MAXZOOM), sf = 1 / (1 << dz);
      const su0 = (x - ((x >> dz) << dz)) * sf, sv0 = (y - ((y >> dz) << dz)) * sf;
      return new SimpleMeshLayer({
        id: String(props.id) + '-m', data: TERRAIN_ANCHOR, getPosition: () => [0, 0, 0],
        _instanced: false, coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        mesh: buildTerrainMesh(t, bb.west, bb.south, bb.east, bb.north, su0, sv0, sf) as any, texture: turl,
        getColor: [255, 255, 255], pickable: false,
        material: { ambient: 0.4, diffuse: 0.85, shininess: 6, specularColor: [30, 30, 30] },
      } as any);
    },
  } as any);
}
