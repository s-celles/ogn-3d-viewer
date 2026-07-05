// ============ ridge / slope lift: a deterministic field from terrain × wind ======
// Unlike thermals (which we must detect from circling probes), slope lift is just
// wind deflected by the ground, so we can PREDICT it from the DEM and the wind —
// everywhere, with or without traffic. The terrain-forced vertical air velocity is
//   w = wind · ∇terrain            (positive where the wind blows uphill)
// We sample it on a grid around the airfield and drape translucent patches, tilted
// to the slope, on the windward faces. Rough and illustrative (see the docs).
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { getWeather, weatherWind } from './weather';
import { getThermals } from './airmass';

const R = 15000;         // scene radius sampled around the airfield (m) — covers the overview
const STEP = 200;        // grid step (m)
const OFF = 10;          // patch lift off the surface, to avoid z-fighting (m)
const W_MIN = 0.4;       // m/s: weakest slope lift / sink drawn
// Strength bins → one mesh each (a single mesh is one colour). Windward lift is a
// pale→bright teal ramp; leeward sink (w<0) a sand→red ramp, both by |w|.
const LIFT: [number, number, number, number][] = [[90, 210, 200, 40], [120, 232, 212, 66], [175, 245, 228, 98]];
const SINK: [number, number, number, number][] = [[205, 165, 95, 34], [212, 120, 68, 58], [205, 78, 54, 92]];
const COLORS = [...LIFT, ...SINK];

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

// Representative low-level wind [east, north] (m/s): the weather profile just above
// the field if available, else the mean thermal drift, else null (no prediction).
function windLow(): [number, number] | null {
  if (S.AF && S.source !== 'file' && S.date) {
    const wx = getWeather(S.AF.lat, S.AF.lon, S.date);
    const w = wx && weatherWind(wx, Math.floor((S.G0 + S.cur) / 3600), S.AF.elev + 300);
    if (w) return w;
  }
  const ths = getThermals();
  if (!ths.length) return null;
  let u = 0, v = 0;
  for (const th of ths) {
    const dur = Math.max(1, th.t1 - th.t0), lat = (th.c0[1] + th.c1[1]) / 2, mLng = 111320 * Math.cos(lat * Math.PI / 180);
    u += (th.c1[0] - th.c0[0]) / dur * mLng; v += (th.c1[1] - th.c0[1]) / dur * 111320;
  }
  return [u / ths.length, v / ths.length];
}

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
// A slope-following quad at a lift cell, tilted by the local gradient.
function addPatch(b: Bin, lon: number, lat: number, hC: number, gx: number, gy: number, half: number, k: number, mLng: number, mLat: number): void {
  const start = b.pos.length / 3;
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const z = (hC + gx * dx + gy * dy + OFF) * k;
    b.pos.push(lon + dx / mLng, lat + dy / mLat, z); b.nrm.push(0, 0, 1);
  }
  b.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

// Memoised per (airfield, date, hour, rounded wind): the field only changes when the
// wind does. Not cached until the terrain under the grid has actually loaded, so it
// refines itself once DEM tiles stream in.
let cache: { key: string; layers: any[] } | null = null;

export function ridgeLayers(k: number): any[] {
  const af = S.AF; if (!af) return [];
  const wind = windLow(); if (!wind) return [];
  const speed = Math.hypot(wind[0], wind[1]); if (speed < 1.5) return [];   // calm → no slope lift
  const hour = Math.floor((S.G0 + S.cur) / 3600);
  const key = `${af.lon.toFixed(2)}|${af.lat.toFixed(2)}|${S.date}|${hour}|${Math.round(wind[0])}|${Math.round(wind[1])}`;
  if (cache && cache.key === key) return cache.layers;

  const mLng = 111320 * Math.cos(af.lat * Math.PI / 180), mLat = 111320, half = STEP * 0.62;   // >STEP/2 → patches overlap into continuous bands
  const bins: Bin[] = [0, 1, 2, 3, 4, 5].map(() => ({ pos: [], nrm: [], idx: [] }));   // 0-2 lift, 3-5 sink
  let cells = 0;
  for (let y = -R; y <= R; y += STEP) for (let x = -R; x <= R; x += STEP) {
    if (x * x + y * y > R * R) continue;
    const lon = af.lon + x / mLng, lat = af.lat + y / mLat;
    const hC = terrainElevAt(lon, lat); if (hC == null) continue;
    const hE = terrainElevAt(lon + STEP / mLng, lat), hW = terrainElevAt(lon - STEP / mLng, lat);
    const hN = terrainElevAt(lon, lat + STEP / mLat), hS = terrainElevAt(lon, lat - STEP / mLat);
    if (hE == null || hW == null || hN == null || hS == null) continue;
    cells++;
    const gx = (hE - hW) / (2 * STEP), gy = (hN - hS) / (2 * STEP);   // terrain gradient (m/m)
    const w = wind[0] * gx + wind[1] * gy;                            // forced vertical velocity (m/s)
    const aw = Math.abs(w);
    if (aw < W_MIN) continue;                                         // near-flat / cross-wind
    const lvl = aw >= 2 ? 2 : aw >= 1 ? 1 : 0;
    addPatch(bins[w > 0 ? lvl : 3 + lvl], lon, lat, hC, gx, gy, half, k, mLng, mLat);   // uphill = lift, downhill = sink
  }
  if (cells < 20) return [];   // terrain not loaded here yet — try again next frame, don't cache

  const layers = bins.map((b, i) => b.idx.length ? new SimpleMeshLayer({
    id: 'ridge-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: COLORS[i], material: false, parameters: meshParams,
    mesh: {
      attributes: { POSITION: { value: new Float32Array(b.pos), size: 3 }, NORMAL: { value: new Float32Array(b.nrm), size: 3 } },
      indices: { value: new Uint32Array(b.idx), size: 1 }, mode: 4,
    } as any,
  } as any) : null).filter(Boolean);
  cache = { key, layers };
  return layers;
}
