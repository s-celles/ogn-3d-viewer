// ============ procedural buildings (illustrative, NOT real) ============
// We don't have real footprints, but the OSM land-cover we already fetch marks the built-up
// (urban) areas. Inside each such polygon we SCATTER plausible building blocks on a per-area
// rotated grid, sized/heighted at random from a deterministic seed (so a place looks the same
// every visit), and extrude them onto the terrain. It's a stylised "city texture" for context
// — the buildings are INVENTED (fictional positions, shapes and heights), not surveyed data.
import { S } from './state';
import { SimpleMeshLayer, PolygonLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { getLC, isUrbanClass, lcVersion } from './landcover';
import type { RGB } from './types';
import { M_PER_LAT, mPerLng, metresPerPixel } from 'soaring-core/geo';

const MINZOOM = 12.5;    // procedural boxes only read well fairly close in
const SP = 26;           // m: grid spacing between buildings inside an urban area
const SKIRT = 3;         // m: sink the base below ground so walls meet the terrain on slopes
const PER_POLY = 1200, MAXB = 8000;   // caps per urban polygon and overall
const WALL: RGB = [198, 192, 183], ROOF: RGB = [150, 146, 139];

// mulberry32 — a tiny deterministic PRNG, seeded per area so the "city" is stable.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function inRing(ring: number[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

interface Box { corners: number[][]; h: number }   // 4 footprint corners [lon,lat] + height (m)
// Scatter buildings on a rotated grid clipped to the urban polygon.
function genBoxes(ring: number[], out: Box[]): void {
  const np = ring.length / 2; if (np < 3 || out.length >= MAXB) return;
  let cLon = 0, cLat = 0, minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (let i = 0; i < np; i++) { const lo = ring[2 * i], la = ring[2 * i + 1]; cLon += lo; cLat += la; if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo; if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; }
  cLon /= np; cLat /= np;
  const mLng = mPerLng(cLat), mLat = M_PER_LAT;
  const seed = Math.floor((cLon + 200) * 8000) ^ Math.floor((cLat + 100) * 8000);
  const rnd = rng(seed >>> 0);
  const th = rnd() * Math.PI, ct = Math.cos(th), st = Math.sin(th);   // per-area grid orientation
  // rotated bounds over the ring
  let ru0 = Infinity, ru1 = -Infinity, rv0 = Infinity, rv1 = -Infinity;
  for (let i = 0; i < np; i++) { const mx = (ring[2 * i] - cLon) * mLng, my = (ring[2 * i + 1] - cLat) * mLat; const u = mx * ct + my * st, v = -mx * st + my * ct; if (u < ru0) ru0 = u; if (u > ru1) ru1 = u; if (v < rv0) rv0 = v; if (v > rv1) rv1 = v; }
  let placed = 0;
  for (let u = ru0; u <= ru1 && placed < PER_POLY && out.length < MAXB; u += SP) for (let v = rv0; v <= rv1 && placed < PER_POLY; v += SP) {
    const ju = u + (rnd() - 0.5) * SP * 0.5, jv = v + (rnd() - 0.5) * SP * 0.5;   // jitter
    const mx = ju * ct - jv * st, my = ju * st + jv * ct, lon = cLon + mx / mLng, lat = cLat + my / mLat;
    if (!inRing(ring, lon, lat)) continue;
    const hw = (7 + rnd() * 8) / 2, hl = (7 + rnd() * 10) / 2, h = 6 + rnd() * 8;   // footprint half-sizes + height (m)
    const corners = ([[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]] as const).map(([dx, dy]) => {
      const rx = dx * ct - dy * st, ry = dx * st + dy * ct;   // rotate footprint to the grid angle
      return [lon + rx / mLng, lat + ry / mLat];
    });
    out.push({ corners, h }); placed++;
  }
}

const meshParams = { depthTest: true, cullMode: 'none' };
const wallMat = { ambient: 0.5, diffuse: 0.9, shininess: 12, specularColor: [25, 25, 25] };
interface Geo { pos: Float32Array; nrm: Float32Array; idx: Uint32Array; roofs: { poly: number[][] }[] }
let cache: { key: string; geo: Geo } | null = null;

function mk(g: Geo): any[] {
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

/** Procedural (illustrative) buildings over the OSM urban areas around the view. */
export function buildingLayers(k: number): any[] {
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  if (zoom < MINZOOM || S.source === 'file') return [];
  const mppx = metresPerPixel(cLat, zoom);
  const R = Math.max(1500, Math.min(6000, mppx * 500));
  const lc = getLC(cLat, cLon, R); if (!lc) return [];   // shares the land-cover fetch (light; may still be loading)
  const key = `${cLat.toFixed(2)}|${cLon.toFixed(2)}|${Math.round(R / 1000)}|${k.toFixed(2)}|${lcVersion()}`;
  if (cache && cache.key === key) return mk(cache.geo);
  const boxes: Box[] = [];
  for (const p of lc.polys) if (isUrbanClass(p.cls)) genBoxes(p.ring, boxes);
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], roofs: { poly: number[][] }[] = [];
  let skipped = 0;
  for (const b of boxes) {
    const c = b.corners; let gx = 0, gy = 0; for (const p of c) { gx += p[0]; gy += p[1]; } gx /= 4; gy /= 4;
    const g = terrainElevAt(gx, gy); if (g == null) { skipped++; continue; }
    const mLng = mPerLng(gy), mLat = M_PER_LAT, zb = (g - SKIRT) * k, zt = (g + b.h) * k;
    for (let i = 0; i < 4; i++) {
      const ax = c[i][0], ay = c[i][1], bx = c[(i + 1) % 4][0], by = c[(i + 1) % 4][1];
      const ex = (bx - ax) * mLng, ey = (by - ay) * mLat, el = Math.hypot(ex, ey) || 1, nx = ey / el, ny = -ex / el;
      const st = pos.length / 3;
      pos.push(ax, ay, zb, bx, by, zb, bx, by, zt, ax, ay, zt);
      for (let q = 0; q < 4; q++) nrm.push(nx, ny, 0);
      idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
    }
    roofs.push({ poly: [[c[0][0], c[0][1], zt], [c[1][0], c[1][1], zt], [c[2][0], c[2][1], zt], [c[3][0], c[3][1], zt]] });
  }
  if (!pos.length) return [];
  const geo: Geo = { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx), roofs };
  if (!skipped) cache = { key, geo };   // cache once every ground resolved (terrain still streaming otherwise)
  return mk(geo);
}
