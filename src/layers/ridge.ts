// ============ drawing the slope-lift field ============
// The physics lives in core/lift/ridge.ts: it turns the DEM and the wind into a field
// of vertical air velocities. This file is the viewer's half — it sizes the grid to the
// current view, asks the kernel for the field, and drapes translucent patches, tilted to
// the local slope, on the windward faces. It is the "Pente" component of the lift
// potential (its opacity set by the mixer weight).
import { S } from '../state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from '../deck';
import { terrainElevAt } from '../terrain';
import { wxEpoch } from '../weather';
import { windBg } from '../wind-source';
import { sceneMs } from '../sky';
import { sunLightDir } from '../core/sky';
import { BIN_COLORS, liftBin } from '../core/liftviz';
import { ridgeField, ridgeActive, type LiftCell } from '../core/lift/ridge';
import { M_PER_LAT, mPerLng, metresPerPixel } from '../core/geo';

const OFF = 10;          // patch lift off the surface, to avoid z-fighting (m)
const MIN_CELLS = 20;    // below this the terrain has not streamed in here yet — don't cache

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
// A slope-following quad at a lift cell, tilted by the local gradient.
function addPatch(b: Bin, c: LiftCell, half: number, k: number, mLng: number, mLat: number): void {
  const start = b.pos.length / 3;
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const z = (c.elev + c.gx * dx + c.gy * dy + OFF) * k;
    b.pos.push(c.lon + dx / mLng, c.lat + dy / mLat, z); b.nrm.push(0, 0, 1);
  }
  b.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

// Memoised on the view (centre + zoom), the hour and the wind: the field is recomputed
// when the wind changes, the zoom changes markedly, or the view has panned more than a
// third of its radius. Wind stays sourced from the view centre — one consistent value
// across the scene (a documented approximation). Not cached until the terrain under the
// grid has loaded, so it refines as DEM tiles stream in.
let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; meshes: { color: number[]; mesh: any }[] } | null = null;

// Fresh layer instances from the cached geometry — a deck layer instance is single
// use, so we must rebuild them each call (reusing a removed one won't re-render).
const mkLayers = (meshes: { color: number[]; mesh: any }[], alpha: number): any[] => meshes.map((m, i) => new SimpleMeshLayer({
  id: 'ridge-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
  coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [m.color[0], m.color[1], m.color[2], Math.round(m.color[3] * alpha)],
  material: false, parameters: meshParams, mesh: m.mesh,
} as any));

export function ridgeLayers(k: number, alpha = 1): any[] {
  if (alpha <= 0) return [];
  // Centre the grid on the view and size it to what's visible, so the bands follow the
  // viewpoint instead of staying pinned to the airfield.
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const wind = windBg(cLat, cLon); if (!wind) return [];
  const ld = sunLightDir(sceneMs(), cLat, cLon);
  const sun: [number, number, number] = [-ld[0], -ld[1], -ld[2]];   // towards the sun
  if (!ridgeActive(wind, sun)) return [];   // calm night — ask before touching the cache or the DEM
  const mppx = metresPerPixel(cLat, zoom);   // metres per pixel
  const R = Math.max(4000, Math.min(20000, mppx * 700));
  const step = Math.max(150, Math.min(500, R / 55));
  const hour = Math.floor((S.G0 + S.cur) / 3600);
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * M_PER_LAT * cosLat, (cache.cLat - cLat) * M_PER_LAT);
    if (moved < R * 0.33) return mkLayers(cache.meshes, alpha);
  }

  const field = ridgeField({ cLon, cLat, R, step }, terrainElevAt, wind, { sun });
  if (field.sampled < MIN_CELLS) return [];   // terrain not loaded here yet — retry next frame, don't cache

  const mLng = mPerLng(cLat), mLat = M_PER_LAT, half = step * 0.62;   // >step/2 → patches overlap into continuous bands
  const bins: Bin[] = BIN_COLORS.map(() => ({ pos: [], nrm: [], idx: [] }));
  for (const c of field.cells) addPatch(bins[liftBin(c.w)], c, half, k, mLng, mLat);

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
