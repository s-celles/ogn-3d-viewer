// ============ OSM building extrusion (autogen 3D city) ============
// Fetch OSM `building` footprints (ways + relation multipolygons) around the view and
// extrude them: walls from the ground up to a height taken from the `height` tag, else
// `building:levels`×3.2 m, else a default. Rendered as one merged wall mesh (lit for depth)
// plus flat roof polygons. Opt-in, capped and radius-limited for performance; only when
// zoomed in enough. Rough, illustrative context — not photogrammetry (see the docs).
import { S } from './state';
import { SimpleMeshLayer, PolygonLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import type { RGB } from './types';

// The main Overpass instance often refuses connections under load — try mirrors in turn.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
async function overpass(q: string): Promise<any> {
  let lastErr: unknown = new Error('no mirror');
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (!res.ok) { lastErr = new Error('http ' + res.status); continue; }
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const MINZOOM = 11;      // below this the view spans too much to fetch/extrude a whole region
const LEVEL_H = 3.2, ROOF_H = 1.5, DEF_H = 7;   // m per level, roof add, fallback height (~2 levels)
const SKIRT = 3;         // m: sink the base below ground so walls meet the terrain on slopes
const MAXB = 12000;      // cap rendered buildings (largest footprints first)
const WALL: RGB = [198, 192, 183], ROOF: RGB = [150, 146, 139];

interface Bldg { ring: number[]; area: number; h: number }   // ring = flat lon,lat,…; area ≈ bbox (for the cap)

const cache = new Map<string, Bldg[] | null>();
const inflight = new Set<string>();
let notify: () => void = () => { };
/** Register a callback fired when a building fetch completes (so the scene re-renders). */
export const onBuildings = (f: () => void): void => { notify = f; };

function parseH(t: Record<string, string>): number {
  const h = t.height ? parseFloat(t.height) : NaN;                       // "12", "12 m"
  if (Number.isFinite(h) && h > 1) return Math.min(220, h);
  const lv = t['building:levels'] ? parseFloat(t['building:levels']) : NaN;
  if (Number.isFinite(lv) && lv > 0) return Math.min(220, lv * LEVEL_H + ROOF_H);
  return DEF_H;
}

type Geo = { lat: number; lon: number };
// Stitch a relation's outer member ways into closed rings (same as land-cover).
function assembleRings(members: Array<{ type: string; role?: string; geometry?: Geo[] }>): Geo[][] {
  const ways = members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry && m.geometry.length >= 2).map(m => m.geometry as Geo[]);
  const used = new Array(ways.length).fill(false), rings: Geo[][] = [];
  const kk = (p: Geo): string => p.lon.toFixed(6) + ',' + p.lat.toFixed(6);
  for (let i = 0; i < ways.length; i++) {
    if (used[i]) continue;
    used[i] = true; let ring = ways[i].slice(), grew = true;
    while (grew && kk(ring[0]) !== kk(ring[ring.length - 1])) {
      grew = false; const end = ring[ring.length - 1];
      for (let j = 0; j < ways.length; j++) {
        if (used[j]) continue; const w = ways[j];
        if (kk(w[0]) === kk(end)) { ring = ring.concat(w.slice(1)); used[j] = true; grew = true; break; }
        if (kk(w[w.length - 1]) === kk(end)) { ring = ring.concat(w.slice(0, -1).reverse()); used[j] = true; grew = true; break; }
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

async function fetchB(key: string, s: number, w: number, n: number, e: number): Promise<void> {
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:40];(way["building"](${bb});relation["building"]["type"="multipolygon"](${bb}););out geom;`;
  try {
    const data = await overpass(q) as { elements?: Array<{ type: string; geometry?: Geo[]; members?: Array<{ type: string; role?: string; geometry?: Geo[] }>; tags?: Record<string, string> }> };
    const blds: Bldg[] = [];
    const addRing = (geom: Geo[] | undefined, h: number): void => {
      if (!geom || geom.length < 3) return;
      const ring: number[] = []; let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
      for (const p of geom) { ring.push(p.lon, p.lat); if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon; if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; }
      blds.push({ ring, h, area: (maxLon - minLon) * (maxLat - minLat) });
    };
    for (const el of (data.elements || [])) {
      const h = parseH(el.tags || {});
      if (el.type === 'way') addRing(el.geometry, h);
      else if (el.type === 'relation' && el.members) for (const r of assembleRings(el.members)) addRing(r.map(p => ({ lat: p.lat, lon: p.lon })), h);
    }
    cache.set(key, blds);
    console.info(`[buildings] ${blds.length} footprints`);
  } catch (e) { cache.set(key, null); console.warn('[buildings] fetch failed', e); }
  ver++; notify();
}

let ver = 0;
export const buildingsVersion = (): number => ver;
const bboxKey = (cLat: number, cLon: number, R: number): string => `${cLat.toFixed(2)}|${cLon.toFixed(2)}|${Math.round(R / 1000)}`;

/** Buildings for the view (Overpass), or null while loading / on failure. */
function getBuildings(cLat: number, cLon: number, R: number): Bldg[] | null {
  const key = bboxKey(cLat, cLon, R);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!inflight.has(key)) {
    inflight.add(key);
    const mLat = 111320, mLng = 111320 * Math.cos(cLat * Math.PI / 180), dLat = R / mLat, dLon = R / mLng;
    fetchB(key, cLat - dLat, cLon - dLon, cLat + dLat, cLon + dLon).finally(() => inflight.delete(key));
  }
  return null;
}

const meshParams = { depthTest: true, cullMode: 'none' };
const wallMat = { ambient: 0.5, diffuse: 0.9, shininess: 12, specularColor: [25, 25, 25] };

interface BuiltGeo { pos: Float32Array; nrm: Float32Array; idx: Uint32Array; roofs: { poly: number[][] }[] }
let geoCache: { key: string; geo: BuiltGeo } | null = null;

// deck layers are single-use, so wrap the cached geometry in fresh instances each call.
function mkBuildingLayers(g: BuiltGeo): any[] {
  return [
    new SimpleMeshLayer({
      id: 'buildings-walls', data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [...WALL, 255], material: wallMat, parameters: meshParams,
      mesh: { attributes: { POSITION: { value: g.pos, size: 3 }, NORMAL: { value: g.nrm, size: 3 } }, indices: { value: g.idx, size: 1 }, mode: 4 },
    } as any),
    new PolygonLayer({
      id: 'buildings-roofs', data: g.roofs, getPolygon: (d: any) => d.poly, extruded: false, stroked: false, filled: true,
      getFillColor: [...ROOF, 255], material: wallMat, parameters: { depthTest: true } as any,
    } as any),
  ];
}

/** Extruded OSM buildings around the view (opt-in). Empty when zoomed out or still loading. */
export function buildingLayers(k: number): any[] {
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  if (zoom < MINZOOM) return [];
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;
  const R = Math.max(1200, Math.min(3500, mppx * 350));   // small fetch radius — dense cities blow up Overpass otherwise
  const all = getBuildings(cLat, cLon, R); if (!all) return [];
  // Cache the merged geometry — rebuild only when the fetched area / exaggeration changes
  // (or while terrain is still streaming in, so late-loading grounds get picked up).
  const key = `${bboxKey(cLat, cLon, R)}|${k.toFixed(2)}|${ver}`;
  if (geoCache && geoCache.key === key) return mkBuildingLayers(geoCache.geo);
  const blds = all.length > MAXB ? [...all].sort((a, b) => b.area - a.area).slice(0, MAXB) : all;
  const mLat = 111320, mLng = 111320 * Math.cos(cLat * Math.PI / 180);
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const roofs: { poly: number[][] }[] = [];
  let skipped = 0;
  for (const b of blds) {
    const ring = b.ring, np = ring.length / 2;
    let cx = 0, cy = 0; for (let i = 0; i < np; i++) { cx += ring[2 * i]; cy += ring[2 * i + 1]; }
    cx /= np; cy /= np;
    const g = terrainElevAt(cx, cy); if (g == null) { skipped++; continue; }   // ground not streamed here yet
    const zb = (g - SKIRT) * k, zt = (g + b.h) * k;
    for (let i = 0; i < np; i++) {   // walls: one quad per footprint edge
      const ax = ring[2 * i], ay = ring[2 * i + 1], bx = ring[2 * ((i + 1) % np)], by = ring[2 * ((i + 1) % np) + 1];
      const ex = (bx - ax) * mLng, ey = (by - ay) * mLat, el = Math.hypot(ex, ey) || 1;
      const nx = ey / el, ny = -ex / el;   // outward-ish horizontal normal
      const st = pos.length / 3;
      pos.push(ax, ay, zb, bx, by, zb, bx, by, zt, ax, ay, zt);
      for (let q = 0; q < 4; q++) nrm.push(nx, ny, 0);
      idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
    }
    const poly: number[][] = []; for (let i = 0; i < np; i++) poly.push([ring[2 * i], ring[2 * i + 1], zt]);
    roofs.push({ poly });   // flat roof cap (deck triangulates concave footprints)
  }
  console.info(`[buildings] built ${roofs.length}, skipped ${skipped} (no ground), zoom ${zoom.toFixed(1)}, R ${Math.round(R)}m`);
  if (!pos.length) return [];
  const geo: BuiltGeo = { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx), roofs };
  if (!skipped) geoCache = { key, geo };   // only cache once every ground resolved (else keep refreshing as tiles stream)
  return mkBuildingLayers(geo);
}
