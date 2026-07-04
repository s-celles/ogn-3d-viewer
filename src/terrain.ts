// ============ terrain: decode terrarium tiles in pure JS (UPNG) and build the mesh ourselves ============
// deck.gl's TerrainLayer decodes terrarium tiles in a Web Worker whose
// createImageBitmap mangles the RGB-encoded elevation (visible as random spikes)
// when the page is served over http. We bypass that pipeline entirely and decode
// with UPNG (a pure-JS PNG decoder) on the main thread.
import UPNG from 'upng-js';
import { S } from './state';
import { TERRAIN, BASEMAPS, TERRAIN_N, DECK_CACHE, ELEV_CACHE, DEM_MAXZOOM, ramCacheFactor,
  IGN_DEM_WMS, IGN_DEM_PX, IGN_DEM_MINZOOM, IGN_DEM_MAXZOOM, IGN_COVER, IGN_ORTHO } from './config';
import { TileLayer, SimpleMeshLayer, PathLayer, TextLayer, COORDINATE_SYSTEM } from './deck';
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
                                 su0 = 0, sv0 = 0, sf = 1, skirtM = 30, zShift = 0) {
  const N = S.dev.on ? S.dev.gridN : TERRAIN_N;
  const { rgba, w, h } = t, cols = N, rows = N, k = S.exo;
  const positions: number[] = [], normals: number[] = [], texCoords: number[] = [], indices: number[] = [];
  const heights = new Float32Array(cols * rows);
  const mPerLat = 111320, mPerLng = 111320 * Math.cos((south + north) / 2 * Math.PI / 180);
  const elevAt = (px: number, py: number) => { const i = (py * w + px) * 4; return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768; };
  // Bilinear DEM sample: nearest-neighbour beats against the mesh grid and shows
  // as corrugations on a sharp DEM (IGN), so interpolate the 4 neighbours.
  const elevBil = (fx: number, fy: number) => {
    fx = Math.max(0, Math.min(w - 1, fx)); fy = Math.max(0, Math.min(h - 1, fy));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const a = elevAt(x0, y0) * (1 - tx) + elevAt(x1, y0) * tx;
    const b = elevAt(x0, y1) * (1 - tx) + elevAt(x1, y1) * tx;
    return a * (1 - ty) + b * ty;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    heights[r * cols + c] = elevBil((su0 + (c / (cols - 1)) * sf) * (w - 1), (sv0 + (1 - r / (rows - 1)) * sf) * (h - 1));
  const dx = (east - west) * mPerLng / (cols - 1), dy = (north - south) * mPerLat / (rows - 1);
  // Slope-adaptive smoothing: blend each vertex toward its neighbours' mean in
  // proportion to the local steepness — nothing on gentle ground (keeps detail),
  // up to ~0.6 on steep faces, where the fine RGE ALTI relief otherwise bands.
  const hs = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c, hC = heights[idx];
    const hL = heights[r * cols + Math.max(0, c - 1)], hR = heights[r * cols + Math.min(cols - 1, c + 1)];
    const hD = heights[Math.max(0, r - 1) * cols + c], hU = heights[Math.min(rows - 1, r + 1) * cols + c];
    const slope = Math.max(Math.abs(hR - hL) / (2 * dx), Math.abs(hU - hD) / (2 * dy));   // ≈ tan(angle)
    const bl = Math.max(0, Math.min(0.6, (slope - 0.5) / 0.7 * 0.6));                     // 0 below ~27°, up to 0.6 by ~50°
    hs[idx] = hC * (1 - bl) + ((hL + hR + hU + hD) / 4) * bl;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1);
    positions.push(west + (east - west) * u, south + (north - south) * v, (hs[r * cols + c] - zShift) * k);
    texCoords.push(u, 1 - v);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const hL = hs[r * cols + Math.max(0, c - 1)], hR = hs[r * cols + Math.min(cols - 1, c + 1)];
    const hD = hs[Math.max(0, r - 1) * cols + c], hU = hs[Math.min(rows - 1, r + 1) * cols + c];
    let nx = -(hR - hL) * k / (2 * dx), ny = -(hU - hD) * k / (2 * dy), nz = 1; const L = Math.hypot(nx, ny, nz) || 1;
    normals.push(nx / L, ny / L, nz / L);
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    indices.push(a, d, b, b, d, e);
  }
  // Skirt: a short vertical wall hanging below each border edge, to hide the
  // hairline crack where adjacent tiles don't share exact edge elevations. Depth
  // (skirtM) is set by the caller from the tile's zoom: tiny on fine near tiles
  // (small cracks — and a deep skirt there would be an in-your-face curtain in
  // oblique views), deeper only on coarse far tiles where LOD steps are large.
  const SKIRT = skirtM * k;
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
  if (!S.dev.on || S.dev.skirts) {   // dev mode can hide skirts to inspect the raw grid
    const top: number[] = [], bot: number[] = [], left: number[] = [], right: number[] = [];
    for (let c = 0; c < cols; c++) { top.push(c); bot.push((rows - 1) * cols + c); }
    for (let r = 0; r < rows; r++) { left.push(r * cols); right.push(r * cols + cols - 1); }
    border(top); border(bot); border(left); border(right);
  }
  return {
    attributes: {
      POSITION: { value: new Float32Array(positions), size: 3 },
      NORMAL: { value: new Float32Array(normals), size: 3 },
      TEXCOORD_0: { value: new Float32Array(texCoords), size: 2 },
    },
    indices: { value: new Uint32Array(indices), size: 1 }, mode: 4,
  };
}

// Grid-line polylines for a tile (dev wireframe): N row lines + N column lines
// sampled from the DEM, so the terrain draws as a see-through mesh with no
// imagery. Same DEM sub-window mapping as buildTerrainMesh.
export function buildTerrainWire(t: DecodedTile, west: number, south: number, east: number, north: number,
                                 su0 = 0, sv0 = 0, sf = 1, N = 48): number[][][] {
  const { rgba, w, h } = t, k = S.exo, H = new Float32Array(N * N);
  const elevAt = (px: number, py: number) => { const i = (py * w + px) * 4; return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768; };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const u = c / (N - 1), v = r / (N - 1);
    const px = Math.min(w - 1, Math.max(0, Math.round((su0 + u * sf) * (w - 1))));
    const py = Math.min(h - 1, Math.max(0, Math.round((sv0 + (1 - v) * sf) * (h - 1))));
    H[r * N + c] = elevAt(px, py);
  }
  const P = (c: number, r: number): number[] => [west + (east - west) * (c / (N - 1)), south + (north - south) * (r / (N - 1)), H[r * N + c] * k];
  const paths: number[][][] = [];
  for (let r = 0; r < N; r++) { const line: number[][] = []; for (let c = 0; c < N; c++) line.push(P(c, r)); paths.push(line); }
  for (let c = 0; c < N; c++) { const line: number[][] = []; for (let r = 0; r < N; r++) line.push(P(c, r)); paths.push(line); }
  return paths;
}

// Decoded-tile elevation cache, populated as tiles stream in (see getTileData).
// Lets us look up the ground elevation under any lng/lat that is currently
// loaded — without any extra network — to keep aircraft from rendering below
// the (coarse) terrain in steep mountains. FIFO-bounded.
interface CachedTile { rgba: Uint8Array; w: number; h: number; }
const TILE_CACHE = new Map<string, CachedTile>();
function cacheTile(z: number, x: number, y: number, t: CachedTile): void {
  TILE_CACHE.set(z + '/' + x + '/' + y, t);
  const limit = Math.round(ELEV_CACHE * ramCacheFactor(S.cacheScale));
  if (TILE_CACHE.size > limit) TILE_CACHE.delete(TILE_CACHE.keys().next().value as string);
}

// Fetch + decode the imagery tile to an ImageBitmap so the mesh can be textured
// the moment it appears (no white flash while a URL-texture streams in). Retries
// once; returns null on failure (rare — the mesh then shows white briefly).
async function fetchImage(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error('http ' + r.status);
      return await createImageBitmap(await r.blob());
    } catch (e) {
      if (signal?.aborted) return null;
      await new Promise(res => setTimeout(res, 200 * (attempt + 1)));
    }
  }
  return null;
}

/** Drop the decoded-DEM cache (e.g. when the IGN-DEM toggle changes). */
export function clearDemCache(): void { TILE_CACHE.clear(); }

// A tile's extent in EPSG:3857 metres (matches how our web-mercator tiles map).
const MERC = 20037508.342789244;
function tile3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (MERC * 2) / 2 ** z, minx = -MERC + x * size, maxy = MERC - y * size;
  return [minx, maxy - size, minx + size, maxy];   // minx, miny, maxx, maxy
}
// Does this tile intersect IGN (RGE ALTI / BD ORTHO) coverage (metropole + DROM)?
function inIgnCover(z: number, x: number, y: number): boolean {
  const bb = tileBBox(x, y, z);
  return IGN_COVER.some(([w, s, e, n]) => bb.east > w && bb.west < e && bb.north > s && bb.south < n);
}

// Fetch one Terrarium DEM tile → decoded RGBA (Terrarium-encoded), or null.
async function fetchTerrarium(z: number, x: number, y: number, signal: AbortSignal): Promise<CachedTile | null> {
  const url = TERRAIN.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error('http ' + r.status);
      const img = UPNG.decode(await r.arrayBuffer());
      return { rgba: new Uint8Array(UPNG.toRGBA8(img)[0]), w: img.width, h: img.height };
    } catch (e) {
      if (signal?.aborted) return null;
      await new Promise(res => setTimeout(res, 200 * (attempt + 1)));
    }
  }
  return null;
}
// The Géoplateforme WMS rate-limits (HTTP 429), so cap how many IGN requests are
// in flight at once — independent of deck's per-layer queues — and queue the rest.
let ignActive = 0;
const ignWaiters: (() => void)[] = [];
const IGN_CONCURRENCY = 3;   // gentle on the Géoplateforme WMS (429/502 under bursts)
function ignAcquire(): Promise<void> {
  if (ignActive < IGN_CONCURRENCY) { ignActive++; return Promise.resolve(); }
  return new Promise(res => ignWaiters.push(res));
}
function ignRelease(): void {
  const next = ignWaiters.shift();
  if (next) next(); else ignActive--;
}
// Fetch the IGN RGE ALTI BIL tile (256×256 float32, EPSG:3857 bbox) → elevations
// in metres, or null (→ Terrarium). Nodata pixels stay as the -99999 sentinel.
// Throttled to IGN_CONCURRENCY; backs off on 429 and gives up rather than storm.
async function fetchIgnDem(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array | null> {
  const [minx, miny, maxx, maxy] = tile3857(z, x, y);
  const url = `${IGN_DEM_WMS}&BBOX=${minx},${miny},${maxx},${maxy}`;
  await ignAcquire();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) return null;
      try {
        const r = await fetch(url, { signal });
        if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 800 * (attempt + 1))); continue; }
        if (!r.ok) throw new Error('http ' + r.status);
        const buf = await r.arrayBuffer();
        if (buf.byteLength < IGN_DEM_PX * IGN_DEM_PX * 4) throw new Error('short');
        const dv = new DataView(buf), out = new Float32Array(IGN_DEM_PX * IGN_DEM_PX);
        for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);   // little-endian
        return out;
      } catch (e) {
        if (signal?.aborted) return null;
        await new Promise(res => setTimeout(res, 300 * (attempt + 1)));
      }
    }
    return null;
  } finally { ignRelease(); }
}
// Encode an elevation grid into a Terrarium RGBA buffer (so the mesh/elevAt paths
// are source-agnostic). Nodata pixels take the Terrarium fallback value.
function encodeDem(elev: Float32Array, fallback: CachedTile | null): CachedTile {
  const N = IGN_DEM_PX, rgba = new Uint8Array(N * N * 4);
  const fw = fallback ? fallback.w : 0, fh = fallback ? fallback.h : 0;   // Terrarium tile may be a different size
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const i = py * N + px;
    let e = elev[i];
    if (!(e > -9000)) {                                                   // nodata (-99999) → Terrarium (scaled sample)
      if (fallback) {
        const fx = Math.min(fw - 1, Math.floor(px / N * fw)), fy = Math.min(fh - 1, Math.floor(py / N * fh)), j = (fy * fw + fx) * 4;
        e = fallback.rgba[j] * 256 + fallback.rgba[j + 1] + fallback.rgba[j + 2] / 256 - 32768;
      } else e = 0;
    }
    const v = e + 32768, R = Math.max(0, Math.min(255, Math.floor(v / 256)));
    const rem = v - R * 256, G = Math.max(0, Math.min(255, Math.floor(rem)));
    const B = Math.max(0, Math.min(255, Math.floor((rem - G) * 256)));
    const o = i * 4; rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
  }
  return { rgba, w: N, h: N };
}

// One decoded DEM tile, cached (many overzoomed imagery tiles share the same
// ancestor DEM). Uses the finer IGN RGE ALTI over France (falling back to
// Terrarium per pixel on nodata / on failure), Terrarium everywhere else.
async function fetchDEM(z: number, x: number, y: number, signal: AbortSignal, allowIgn: boolean): Promise<DecodedTile | null> {
  const hit = TILE_CACHE.get(z + '/' + x + '/' + y);
  if (hit) return hit;
  const useIgn = allowIgn && S.ignDem && z >= IGN_DEM_MINZOOM && z <= IGN_DEM_MAXZOOM && inIgnCover(z, x, y);
  const terr = await fetchTerrarium(z, x, y, signal);
  if (signal?.aborted) return null;
  let dec: CachedTile | null = terr;
  if (useIgn) {
    const ign = await fetchIgnDem(z, x, y, signal);
    if (ign) {
      let nodata = false;
      for (let i = 0; i < ign.length; i++) if (!(ign[i] > -9000)) { nodata = true; break; }
      // Only fill gaps if we actually have Terrarium — otherwise skip the merge so
      // nodata pixels never collapse to 0 m (a pit/hole punched in the massif).
      if (!nodata) dec = encodeDem(ign, null);
      else if (terr) dec = encodeDem(ign, terr);
    }
  }
  if (dec) cacheTile(z, x, y, dec);
  return dec;
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

/** Number of DEM tiles currently held in the elevation cache (dev counter). */
export function terrainCacheSize(): number { return TILE_CACHE.size; }

/** Build the streaming terrain TileLayer (rebuilt whenever exaggeration changes). */
const basemap = () => BASEMAPS[S.basemap] || BASEMAPS.esri;
// Imagery URL for a tile: sharp IGN BD ORTHO wherever the tile touches France
// (BD ORTHO serves real imagery across the border too, so front and back stay
// visually consistent — no ortho↔basemap seam mid-view), the basemap elsewhere.
const texUrl = (z: number, x: number, y: number): string => {
  const tpl = (S.ignDem && inIgnCover(z, x, y)) ? IGN_ORTHO : basemap().url;
  return tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
};

export function makeTerrain() {
  const dev = S.dev;
  const deckCache = dev.on ? dev.deckCache : Math.round(DECK_CACHE * ramCacheFactor(S.cacheScale));
  const gm = Math.min(S.groundZoom, basemap().imgMax);   // don't request imagery deeper than the provider serves
  // Two stacked layers so cold starts never show white/holes: a coarser BASE
  // (lighter tiles, its own wide request queue → loads first and always covers
  // the whole view, textured) UNDER the full-detail layer, sunk a little so
  // wherever detail has loaded it wins. The base DEM must be fine enough to
  // follow valleys: at z≤9 (~800 m between mesh vertices) it skips narrow alpine
  // valleys entirely and overshoots the floor by hundreds of metres, poking
  // through detail as flat patches — z11 (~200 m spacing) keeps the overshoot
  // under the sink. It only fills gaps until detail arrives, so the sink is safe.
  // Suffix the layer ids with the base map: switching it changes the ids, so
  // deck drops the old cached (Esri-textured) tiles and refetches from the new
  // provider — a full refresh, not just newly-panned tiles.
  const tag = `${S.basemap}-${S.ignDem ? 'ign' : 't'}`;   // id encodes the DEM source too → toggling refetches
  return [
    tileLayer(dev, `terrain-base-${tag}`, Math.min(11, gm), 64, 96, 140),          // Terrarium only (coarse backdrop)
    tileLayer(dev, `terrain-${tag}`, gm, deckCache, dev.on ? dev.maxRequests : 12, 0, true),   // detail: IGN over France
  ];
}

function tileLayer(dev: typeof S.dev, id: string, maxZoom: number, maxCacheSize: number, maxRequests: number, zShiftM: number, allowIgn = false) {
  return new TileLayer({
    // maxZoom = the ground-detail setting. Up to the DEM ceiling (15) each tile
    // is a normal DEM tile textured with its own Esri image; BEYOND 15 the tile
    // takes its DEM elevation from the coarser z15 ancestor while still fetching
    // full-resolution Esri imagery at its own zoom — so the photo keeps sharpening.
    id, data: TERRAIN, minZoom: 0, maxZoom, tileSize: 256, maxCacheSize,
    // In first-person/chase the tilted frustum sees a wide swathe to the horizon,
    // so many tiles are in flight at once. The default 6 concurrent requests drain
    // the queue too slowly (background stays blurry/holey); raise it. 'best-available'
    // keeps a coarse ancestor tile drawn while its children load, so gaps read as
    // blur that sharpens rather than sky showing through the ground.
    maxRequests, refinementStrategy: 'best-available',
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
      // Fetch the imagery in parallel and hold the tile until BOTH are ready, so
      // it never appears as an untextured white patch (deck keeps the textured
      // parent tile meanwhile).
      const dz = Math.max(0, z - DEM_MAXZOOM);
      const turl = texUrl(z, x, y);
      const [dem, image] = await Promise.all([
        fetchDEM(z - dz, x >> dz, y >> dz, tile.signal, allowIgn),
        fetchImage(turl, tile.signal),
      ]);
      return dem ? { ...dem, image } : null;
    },
    renderSubLayers: (props: any) => {
      const t = props.data as DecodedTile | null; if (!t) return null;
      const { x, y, z } = props.tile.index, bb = tileBBox(x, y, z);
      const turl = texUrl(z, x, y);
      // Which fraction of the (possibly coarser) ancestor DEM this tile covers.
      const dz = Math.max(0, z - DEM_MAXZOOM), sf = 1 / (1 << dz);
      const su0 = (x - ((x >> dz) << dz)) * sf, sv0 = (y - ((y >> dz) << dz)) * sf;
      // Skirt depth scales with how coarse the tile is: ~8 m on the finest tiles
      // (imperceptible up close) up to a clamp on distant coarse tiles where the
      // LOD steps between neighbours are large. Halved every zoom level.
      const skirtM = Math.min(160, Math.max(8, 8 * 2 ** (DEM_MAXZOOM - Math.min(z, DEM_MAXZOOM))));
      // Wireframe: draw the mesh grid as green see-through lines (no imagery).
      // Otherwise a solid mesh — textured, or bare grey when noTexture is on.
      const base = (dev.on && dev.wireframe)
        ? new PathLayer({
            id: String(props.id) + '-w', data: buildTerrainWire(t, bb.west, bb.south, bb.east, bb.north, su0, sv0, sf, dev.gridN),
            getPath: (d: any) => d, getColor: [120, 220, 120], getWidth: 1, widthUnits: 'pixels', pickable: false,
          } as any)
        : new SimpleMeshLayer({
            id: String(props.id) + '-m', data: TERRAIN_ANCHOR, getPosition: () => [0, 0, 0],
            _instanced: false, coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            mesh: buildTerrainMesh(t, bb.west, bb.south, bb.east, bb.north, su0, sv0, sf, skirtM, zShiftM) as any,
            texture: (dev.on && dev.noTexture) ? undefined : (t.image || turl),
            // Trilinear + anisotropic sampling so the draped imagery doesn't alias
            // into horizontal bands on steep faces seen at a grazing angle.
            textureParameters: { minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 },
            getColor: (dev.on && dev.noTexture) ? [150, 155, 160] : [255, 255, 255], pickable: false,
            material: { ambient: 0.4, diffuse: 0.85, shininess: 6, specularColor: [30, 30, 30] },
          } as any);
      if (!dev.on || !dev.tileBounds) return base;
      // Debug overlay: outline the tile and label its z/x/y (near the mid elevation).
      const cLon = (bb.west + bb.east) / 2, cLat = (bb.south + bb.north) / 2;
      const midE = (terrainElevAt(cLon, cLat) || 0) * S.exo;
      const ring = [[bb.west, bb.south, midE], [bb.east, bb.south, midE], [bb.east, bb.north, midE], [bb.west, bb.north, midE], [bb.west, bb.south, midE]];
      return [
        base,
        new PathLayer({ id: String(props.id) + '-b', data: [ring], getPath: (d: any) => d, getColor: [255, 230, 0], getWidth: 1.5, widthUnits: 'pixels', parameters: { depthTest: false } } as any),
        new TextLayer({ id: String(props.id) + '-t', data: [{ p: [cLon, cLat, midE], s: `${z}/${x}/${y}` }], getPosition: (d: any) => d.p, getText: (d: any) => d.s, getSize: 12, getColor: [255, 230, 0], background: true, getBackgroundColor: [0, 0, 0, 160], parameters: { depthTest: false } } as any),
      ];
    },
  } as any);
}
