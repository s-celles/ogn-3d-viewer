// ============ drawing the thermal potential ============
// The physics lives in core/lift/thermal.ts: sun × slope × land cover × boundary-layer depth
// into an updraught Vz per cell. This file is the viewer's half — it reads the weather and the
// land cover, sizes the grid to the view, drapes the coloured patches on the terrain, and puts
// the predicted cumulus over the strongest cores.
import { S } from '../state';
import { SimpleMeshLayer, IconLayer, COORDINATE_SYSTEM } from '../deck';
import { terrainElevAt } from '../terrain';
import { sceneMs } from '../sky';
import { sunLightDir } from '../core/sky';
import { getWeather, weatherRad, weatherConvTop, weatherCloudbase, weatherWind, wxEpoch } from '../weather';
import { cloudSprite } from '../airmass';
import { getLC, sampleGrid, lcVersion } from '../landcover';
import { liftCalibration } from '../calib';
import { THERMAL_COLORS, thermalBin } from '../core/liftviz';
import {
  thermalField, cumulusSpots, snowLineM, diurnalStore, SUN_MIN,
  type ThermalField, type LandCover, type Streets,
} from '../core/lift/thermal';
import { M_PER_LAT, mPerLng, metresPerPixel } from '../core/geo';

const GN = 80;           // grid nodes per side (map resolution)
const OFF = 26;          // drape offset (m) — float above the fine terrain, no sinking/holes
const READY_FRAC = 0.4;  // below this share of loaded nodes the terrain has not streamed in yet
const STREET_RATIO = 2.7;   // across-wind cloud-street spacing ≈ this × the convective depth z_i
const STREET_ZI_MIN = 800;  // m: minimum convective depth for streets to organise
const STREET_WIND_MIN = 4;  // m/s: minimum boundary-layer wind for streets
const STREET_AMP = 0.5;     // ± modulation of the heat flux along / between the streets

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Puff { pos: [number, number, number]; size: number }
interface GridKey { cLon: number; cLat: number; R: number }

// The DEM sampling is the expensive part and it does not change with time, so the whole field
// is memoised on the view AND on everything the physics depends on (the 15-min bucket, the
// weather epoch, the land-cover version, the calibration, the heat-storage knob).
let cache: {
  gk: GridKey; k: number; bucket: number; wxr: boolean; lcv: number; cal: number; wxe: number; hs: number;
  meshes: { color: number[]; mesh: any }[]; cu: Puff[];
} | null = null;

const sameView = (a: GridKey, b: GridKey): boolean =>
  Math.abs(Math.log(a.R / b.R)) < 0.25
  && Math.hypot((a.cLon - b.cLon) * mPerLng(a.cLat), (a.cLat - b.cLat) * M_PER_LAT) < b.R * 0.33;

/** Draped patches coloured by the estimated thermal updraught (Vz), from sun × slope × heat
 *  flux × w*. Empty at night, or when the terrain/date is unavailable. */
export function thermalLayers(k: number, alpha = 1): any[] {
  const ms = sceneMs();
  if (alpha <= 0 || !Number.isFinite(ms)) return [];
  if (!S.wxSim.on && !S.date) return [];
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const R = Math.max(4000, Math.min(20000, metresPerPixel(cLat, zoom) * 700));

  // Sun: unit vector toward the sun (ENU); the light-travel direction is its negation.
  const ld = sunLightDir(ms, cLat, cLon);
  const sun: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
  if (sun[2] <= SUN_MIN) return [];   // sun at or below the horizon → no thermals

  // Radiation + boundary-layer depth from the weather (else nominal clear-sky values).
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wx = (S.wxSim.on || S.source !== 'file') ? getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date) : null;
  const radn = wx ? weatherRad(wx, hour) : { sw: NaN, diff: NaN, blh: NaN };
  const diff = Number.isFinite(radn.diff) ? radn.diff : 90;
  const dni = Math.min(1050, Math.max(0, ((Number.isFinite(radn.sw) ? radn.sw : 1000 * sun[2]) - diff)) / sun[2]);
  const convTop = wx ? weatherConvTop(wx, hour) : NaN;
  const cloudbase = wx ? weatherCloudbase(wx, hour) : null;
  const isCu = cloudbase != null && Number.isFinite(convTop) && convTop >= cloudbase + 80;
  const ziFallback = Number.isFinite(radn.blh) && radn.blh > 200 ? radn.blh : 1500;

  const gRef = terrainElevAt(cLon, cLat);
  const refElev = gRef != null ? gRef : (S.AF ? S.AF.elev : 0);
  const ziRef = Math.max(0, Math.min(3500, Number.isFinite(convTop) ? convTop - refElev : ziFallback));

  // Cloud streets: with enough boundary-layer wind and depth, thermals organise into rolls
  // aligned with the wind, spaced ~STREET_RATIO × z_i — lift on the street lines, subsidence
  // between. A redistribution of the heat flux across-wind, not extra energy.
  let street: Streets | null = null;
  const stWind = wx && ziRef > STREET_ZI_MIN ? weatherWind(wx, hour, refElev + Math.max(400, ziRef * 0.5)) : null;
  if (stWind) {
    const ws = Math.hypot(stWind[0], stWind[1]);
    if (ws > STREET_WIND_MIN) street = {
      pE: -stWind[1] / ws, pN: stWind[0] / ws,          // unit ⟂ to the wind (across-street)
      k: 2 * Math.PI / (STREET_RATIO * ziRef),
      amp: STREET_AMP * Math.min(1, (ws - STREET_WIND_MIN) / 2),
    };
  }

  // Day-scale calibration from the observed climbs (1 without enough tracks): grounds the
  // absolute magnitude in the day's real thermals, so red means "as strong as today's best".
  const cal = liftCalibration();
  const lc = S.source !== 'file' ? getLC(cLat, cLon, R) : null;
  const lcv = lc ? lcVersion() : -1;
  const bucket = Math.floor((S.G0 + S.cur) / 900);   // recompute every ~15 min of sim time
  const wxe = wxEpoch();                              // sandbox atmosphere version (incl. its date/hour)
  const gk: GridKey = { cLon, cLat, R };

  if (!cache || !sameView(cache.gk, gk) || cache.k !== k || cache.bucket !== bucket
    || cache.wxr !== !!wx || cache.lcv !== lcv || cache.cal !== cal || cache.wxe !== wxe || cache.hs !== S.heatStore) {
    const grid = { cLon, cLat, R, n: GN };
    const cover: LandCover | null = lc ? sampleGrid(lc, cLat, cLon, R, GN) : null;
    const f = thermalField(grid, terrainElevAt, {
      sun, dni, diff, convTop, ziFallback, refElev, cal,
      heatStore: S.heatStore,
      dM: S.heatStore > 0 ? diurnalStore(ms, cLat, cLon) : 0,
      snowLine: snowLineM(ms, cLat),
      lc: cover, street,
    });
    if (f.ready < f.total * READY_FRAC) return [];   // terrain not loaded yet — retry next frame, don't cache

    const meshes = buildMeshes(f, k);
    // Predicted cumulus on a cu day: a cloud at the base over the strongest cores. A blue day
    // (ceiling below the LCL) gets none.
    const cu: Puff[] = isCu
      ? cumulusSpots(f, {
        cloudbase: cloudbase as number, wRef: f.wRef, scaleRef: f.scaleRef,
        drift: wx ? weatherWind(wx, hour, (refElev + (cloudbase as number)) / 2) : null,
      }).map(s => ({ pos: [s.lon, s.lat, s.base * k] as [number, number, number], size: s.size }))
      : [];
    cache = { gk, k, bucket, wxr: !!wx, lcv, cal, wxe, hs: S.heatStore, meshes, cu };
  }

  const layers: any[] = cache.meshes.map((m, i) => new SimpleMeshLayer({
    id: 'thermal-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [m.color[0], m.color[1], m.color[2], Math.round(m.color[3] * alpha)],
    material: false, parameters: meshParams, mesh: m.mesh,
  } as any));
  if (cache.cu.length) layers.push(new IconLayer({
    id: 'thermal-cu', data: cache.cu,
    iconAtlas: cloudSprite(), iconMapping: { p: { x: 0, y: 0, width: 128, height: 128, mask: true } } as any,
    getIcon: () => 'p', getPosition: (d: any) => d.pos, getSize: (d: any) => d.size,
    getColor: [255, 255, 255, Math.round(215 * alpha)], sizeUnits: 'meters', billboard: true,
    parameters: { depthCompare: 'less-equal', depthWriteEnabled: false } as any,
  } as any));
  return layers;
}

// One quad per cell, draped on the four terrain nodes under it, in the bin its Vz falls in.
function buildMeshes(f: ThermalField, k: number): { color: number[]; mesh: any }[] {
  const n = f.grid.n, nw = f.nw;
  const bins = THERMAL_COLORS.map(() => ({ pos: [] as number[], nrm: [] as number[], idx: [] as number[] }));
  for (let j = 0; j < nw; j++) for (let i = 0; i < nw; i++) {
    const vz = f.vz[j * nw + i];
    if (Number.isNaN(vz)) continue;
    const bin = thermalBin(vz, f.wRef, f.scaleRef);
    if (bin == null) continue;
    const B = bins[bin], st = B.pos.length / 3;
    const P = (ii: number, jj: number, h: number) => { B.pos.push(f.lon[ii], f.lat[jj], h * k + OFF); B.nrm.push(0, 0, 1); };
    P(i, j, f.h[j * n + i]);
    P(i + 1, j, f.h[j * n + i + 1]);
    P(i + 1, j + 1, f.h[(j + 1) * n + i + 1]);
    P(i, j + 1, f.h[(j + 1) * n + i]);
    B.idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
  }
  return bins.map((B, i) => B.idx.length ? {
    color: THERMAL_COLORS[i],
    mesh: {
      attributes: { POSITION: { value: new Float32Array(B.pos), size: 3 }, NORMAL: { value: new Float32Array(B.nrm), size: 3 } },
      indices: { value: new Uint32Array(B.idx), size: 1 }, mode: 4,
    },
  } : null).filter(Boolean) as { color: number[]; mesh: any }[];
}
