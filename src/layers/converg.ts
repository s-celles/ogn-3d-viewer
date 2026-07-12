// ============ drawing the convergence field ============
// The physics lives in core/lift/converg.ts: it turns the DEM, the wind and a water mask
// into a field of normalised convergence. This file is the viewer's half — it sizes the
// lattice to the view, fetches the land cover the breeze needs, and drapes translucent
// patches, tilted to the local slope, so the bands lie on the ground. The "Convergence"
// component of the lift potential (its opacity set by the mixer weight).
import { S } from '../state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from '../deck';
import { terrainElevAt } from '../terrain';
import { windBg } from '../wind-source';
import { sceneMs } from '../sky';
import { sunLightDir } from '../core/sky';
import { getLC, sampleGrid, lcVersion } from '../landcover';
import { wxEpoch } from '../weather';
import { BIN_COLORS, strataBin } from '../core/liftviz';
import { insolation } from '../core/lift/ridge';
import { convergField, convergActive, nodeStep, CONV_FRAC, type ConvCell } from '../core/lift/converg';
import { M_PER_LAT, mPerLng, metresPerPixel } from '../core/geo';

const NG = 64;           // grid nodes per side
const OFF = 12;          // patch lift off the surface (m) — avoid z-fighting
const READY_FRAC = 0.4;  // below this share of loaded nodes the terrain has not streamed in yet

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
// A slope-following quad at a cell, tilted by the local gradient (so bands lie on the ground).
function addPatch(b: Bin, c: ConvCell, half: number, k: number, mLng: number, mLat: number): void {
  const start = b.pos.length / 3;
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const z = (c.elev + c.gx * dx + c.gy * dy + OFF) * k;
    b.pos.push(c.lon + dx / mLng, c.lat + dy / mLat, z); b.nrm.push(0, 0, 1);
  }
  b.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

// Fresh layer instances from cached geometry (deck layers are single-use), alpha-scaled.
const mkLayers = (meshes: { color: number[]; mesh: any }[], alpha: number): any[] => meshes.map((m, i) => new SimpleMeshLayer({
  id: 'converg-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
  coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [m.color[0], m.color[1], m.color[2], Math.round(m.color[3] * alpha)],
  material: false, parameters: meshParams, mesh: m.mesh,
} as any));

let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; meshes: { color: number[]; mesh: any }[] } | null = null;

export function convergLayers(k: number, alpha = 1): any[] {
  if (alpha <= 0) return [];
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const wind = windBg(cLat, cLon); if (!wind) return [];
  const R = Math.max(4000, Math.min(20000, metresPerPixel(cLat, zoom) * 700));
  // Lake-breeze source: the sun's heating contrast + a water mask (only fetched by day).
  const ld = sunLightDir(sceneMs(), cLat, cLon);
  const insol = insolation([-ld[0], -ld[1], -ld[2]]);
  const lc = insol > 0 && S.source !== 'file' ? getLC(cLat, cLon, R) : null;
  if (!convergActive(wind, !!lc)) return [];   // calm and no shoreline — ask before the cache or the DEM
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}|${lc ? lcVersion() : -1}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const moved = Math.hypot((cache.cLon - cLon) * mPerLng(cLat), (cache.cLat - cLat) * M_PER_LAT);
    if (moved < R * 0.33) return mkLayers(cache.meshes, alpha);
  }

  const grid = { cLon, cLat, R, n: NG };
  const water = lc ? sampleGrid(lc, cLat, cLon, R, NG).sens : null;
  const field = convergField(grid, terrainElevAt, wind, { insol, water });
  if (field.ready < field.total * READY_FRAC) return [];   // terrain not loaded here yet — retry next frame, don't cache

  const mLng = mPerLng(cLat), mLat = M_PER_LAT, half = nodeStep(grid) * 0.62;
  const bins: Bin[] = BIN_COLORS.map(() => ({ pos: [], nrm: [], idx: [] }));   // 0-2 conv, 3-5 div
  for (const c of field.cells) addPatch(bins[strataBin(c.c, CONV_FRAC)], c, half, k, mLng, mLat);

  const meshes = bins.map((b, i) => b.idx.length ? {
    color: BIN_COLORS[i],
    mesh: {
      attributes: { POSITION: { value: new Float32Array(b.pos), size: 3 }, NORMAL: { value: new Float32Array(b.nrm), size: 3 } },
      indices: { value: new Uint32Array(b.idx), size: 1 }, mode: 4,
    },
  } : null).filter(Boolean) as { color: number[]; mesh: any }[];
  cache = { cLon, cLat, R, hour, wk, meshes };
  return mkLayers(meshes, alpha);
}
