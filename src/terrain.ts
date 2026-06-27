// ============ terrain: decode terrarium tiles in pure JS (UPNG) and build the mesh ourselves ============
// deck.gl's TerrainLayer decodes terrarium tiles in a Web Worker whose
// createImageBitmap mangles the RGB-encoded elevation (visible as random spikes)
// when the page is served over http. We bypass that pipeline entirely and decode
// with UPNG (a pure-JS PNG decoder) on the main thread.
import UPNG from 'upng-js';
import { S } from './state';
import { TERRAIN, TEXTURE, TERRAIN_N } from './config';
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

/** Build a textured, lit mesh (positions/normals/texCoords) from a decoded tile. */
export function buildTerrainMesh(t: DecodedTile, west: number, south: number, east: number, north: number) {
  const { rgba, w, h } = t, cols = TERRAIN_N, rows = TERRAIN_N, k = S.exo;
  const positions = new Float32Array(cols * rows * 3), normals = new Float32Array(cols * rows * 3),
        texCoords = new Float32Array(cols * rows * 2), heights = new Float32Array(cols * rows);
  const mPerLat = 111320, mPerLng = 111320 * Math.cos((south + north) / 2 * Math.PI / 180);
  const elevAt = (px: number, py: number) => { const i = (py * w + px) * 4; return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1);
    const e = elevAt(Math.min(w - 1, Math.round(u * (w - 1))), Math.min(h - 1, Math.round((1 - v) * (h - 1)))), idx = r * cols + c;
    heights[idx] = e;
    positions[idx * 3] = west + (east - west) * u; positions[idx * 3 + 1] = south + (north - south) * v; positions[idx * 3 + 2] = e * k;
    texCoords[idx * 2] = u; texCoords[idx * 2 + 1] = 1 - v;
  }
  const dx = (east - west) * mPerLng / (cols - 1), dy = (north - south) * mPerLat / (rows - 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c;
    const hL = heights[r * cols + Math.max(0, c - 1)], hR = heights[r * cols + Math.min(cols - 1, c + 1)];
    const hD = heights[Math.max(0, r - 1) * cols + c], hU = heights[Math.min(rows - 1, r + 1) * cols + c];
    let nx = -(hR - hL) * k / (2 * dx), ny = -(hU - hD) * k / (2 * dy), nz = 1; const L = Math.hypot(nx, ny, nz) || 1;
    normals[idx * 3] = nx / L; normals[idx * 3 + 1] = ny / L; normals[idx * 3 + 2] = nz / L;
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6); let q = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    indices[q++] = a; indices[q++] = d; indices[q++] = b; indices[q++] = b; indices[q++] = d; indices[q++] = e;
  }
  return {
    attributes: { POSITION: { value: positions, size: 3 }, NORMAL: { value: normals, size: 3 }, TEXCOORD_0: { value: texCoords, size: 2 } },
    indices: { value: indices, size: 1 }, mode: 4,
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
  if (TILE_CACHE.size > 400) TILE_CACHE.delete(TILE_CACHE.keys().next().value as string);
}

// Ground elevation (m, orthometric) at a lng/lat from the highest-resolution
// loaded tile covering it, or null if no covering tile is currently cached.
export function terrainElevAt(lon: number, lat: number): number | null {
  for (let z = 13; z >= 7; z--) {
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
    id: 'terrain', data: TERRAIN, minZoom: 0, maxZoom: 13, tileSize: 256, maxCacheSize: 300,
    getTileData: async (tile: any): Promise<DecodedTile | null> => {
      const { x, y, z } = tile.index || tile;
      const url = TERRAIN.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      try {
        const buf = await fetch(url, { signal: tile.signal }).then(r => r.arrayBuffer());
        const img = UPNG.decode(buf);
        const dec = { rgba: new Uint8Array(UPNG.toRGBA8(img)[0]), w: img.width, h: img.height };
        cacheTile(z, x, y, dec);
        return dec;
      } catch (e) { return null; }
    },
    renderSubLayers: (props: any) => {
      const t = props.data as DecodedTile | null; if (!t) return null;
      const { x, y, z } = props.tile.index, bb = tileBBox(x, y, z);
      const turl = TEXTURE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      return new SimpleMeshLayer({
        id: String(props.id) + '-m', data: TERRAIN_ANCHOR, getPosition: () => [0, 0, 0],
        _instanced: false, coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        mesh: buildTerrainMesh(t, bb.west, bb.south, bb.east, bb.north) as any, texture: turl,
        getColor: [255, 255, 255], pickable: false,
        material: { ambient: 0.4, diffuse: 0.85, shininess: 6, specularColor: [30, 30, 30] },
      } as any);
    },
  } as any);
}
