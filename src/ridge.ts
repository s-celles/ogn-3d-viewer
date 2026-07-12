// ============ ridge / slope lift: a deterministic field from terrain × wind ======
// Unlike thermals (which we must detect from circling probes), slope lift is just
// wind deflected by the ground, so we can PREDICT it from the DEM and the wind —
// everywhere, with or without traffic. The terrain-forced vertical air velocity is
//   w = wind · ∇terrain            (positive where the wind blows uphill)
// We sample it on a grid around the airfield and drape translucent patches, tilted
// to the slope, on the windward faces. It is the "Pente" component of the lift
// potential (its opacity set by the mixer weight). Rough and illustrative (see docs).
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { getWeather, weatherWind, wxEpoch } from './weather';
import { sunLightDir, sceneMs } from './sky';
import { getThermals } from './airmass';
import { LIFT_COLORS, SINK_COLORS } from './core/liftviz';

const OFF = 10;          // patch lift off the surface, to avoid z-fighting (m)
const LU = 900;          // upwind probe distance for terrain sheltering (m)
const H_SHELTER = 320;   // upwind terrain this much higher → wind ~fully sheltered (m)
const W_MIN = 0.4;       // m/s: weakest slope lift / sink drawn
const ANA_GAIN = 4.0;    // anabatic (thermal upslope) wind gain — sunny slopes lift on calm days
const INSOL_REF = 0.25;  // sin(sun elevation) at which daytime heating saturates the anabatic wind
// Strength bins → one mesh each. Shared lift ramp: windward lift is warm (it climbs),
// leeward sink (w<0) cool blue (it descends), both keyed by |w|.
const COLORS = [LIFT_COLORS[0], LIFT_COLORS[2], LIFT_COLORS[4], ...SINK_COLORS];

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

// Mean thermal drift (m/s) — the last-resort wind when there is no weather.
function driftWind(): [number, number] | null {
  const ths = getThermals();
  if (!ths.length) return null;
  let u = 0, v = 0;
  for (const th of ths) {
    const dur = Math.max(1, th.t1 - th.t0), lat = (th.c0[1] + th.c1[1]) / 2, mLng = 111320 * Math.cos(lat * Math.PI / 180);
    u += (th.c1[0] - th.c0[0]) / dur * mLng; v += (th.c1[1] - th.c0[1]) / dur * 111320;
  }
  return [u / ths.length, v / ths.length];
}

/** Wind [east, north] (m/s) at an AMSL altitude: the weather profile at the view
 *  centre (bucketed ~10 km), else at the airfield, else the mean thermal drift. */
export function windAtAlt(cLat: number, cLon: number, alt: number): [number, number] | null {
  if (S.wxSim.on || (S.source !== 'file' && S.date)) {
    const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
    const pick = (la: number, lo: number): [number, number] | null => {
      const wx = getWeather(la, lo, S.date); return wx ? weatherWind(wx, hour, alt) : null;
    };
    const w = pick(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1) || (S.AF ? pick(S.AF.lat, S.AF.lon) : null);
    if (w) return w;
  }
  return driftWind();
}

// Background low-level wind: the profile ~mid-ridge above the local surface.
export function windBg(cLat: number, cLon: number): [number, number] | null {
  return windAtAlt(cLat, cLon, (terrainElevAt(cLon, cLat) ?? (S.AF ? S.AF.elev : 0)) + 400);
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

// Memoised on the view (centre + zoom), the hour and the wind: the field is
// recomputed when the wind changes, the zoom changes markedly, or the view has
// panned more than a third of its radius. Wind stays sourced from the airfield —
// one consistent value across the scene (a documented approximation). Not cached
// until the terrain under the grid has loaded, so it refines as DEM tiles stream in.
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
  // Centre the grid on the view and size it to what's visible, so the bands follow
  // the viewpoint instead of staying pinned to the airfield.
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const wind = windBg(cLat, cLon); if (!wind) return [];
  const s0 = Math.hypot(wind[0], wind[1]);
  // Anabatic (thermally-driven upslope) wind: on a sunny day the heated slopes drive an
  // up-slope flow that lifts even when the synoptic wind is calm. Its strength follows the
  // insolation (sun elevation) globally and the sun-facing exposure of each cell below.
  const ld = sunLightDir(sceneMs(), cLat, cLon), su: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
  const insol = Number.isFinite(su[2]) ? Math.max(0, Math.min(1, su[2] / INSOL_REF)) : 0;
  if (s0 < 1.5 && insol <= 0) return [];                              // calm AND night → nothing
  const calm = s0 < 0.5;
  const upE = calm ? 0 : -wind[0] / s0, upN = calm ? 0 : -wind[1] / s0;   // upwind unit, for terrain sheltering
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;   // metres per pixel
  const R = Math.max(4000, Math.min(20000, mppx * 700));
  const STEP = Math.max(150, Math.min(500, R / 55));
  const hour = Math.floor((S.G0 + S.cur) / 3600);
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * 111320 * cosLat, (cache.cLat - cLat) * 111320);
    if (moved < R * 0.33) return mkLayers(cache.meshes, alpha);
  }
  const mLng = 111320 * Math.cos(cLat * Math.PI / 180), mLat = 111320, half = STEP * 0.62;   // >STEP/2 → patches overlap into continuous bands
  const bins: Bin[] = [0, 1, 2, 3, 4, 5].map(() => ({ pos: [], nrm: [], idx: [] }));   // 0-2 lift, 3-5 sink
  let cells = 0;
  for (let y = -R; y <= R; y += STEP) for (let x = -R; x <= R; x += STEP) {
    if (x * x + y * y > R * R) continue;
    const lon = cLon + x / mLng, lat = cLat + y / mLat;
    const hC = terrainElevAt(lon, lat); if (hC == null) continue;
    const hE = terrainElevAt(lon + STEP / mLng, lat), hW = terrainElevAt(lon - STEP / mLng, lat);
    const hN = terrainElevAt(lon, lat + STEP / mLat), hS = terrainElevAt(lon, lat - STEP / mLat);
    if (hE == null || hW == null || hN == null || hS == null) continue;
    cells++;
    const gx = (hE - hW) / (2 * STEP), gy = (hN - hS) / (2 * STEP);   // terrain gradient (m/m)
    // Refine the wind with the terrain: higher ground upwind shelters this cell
    // (less lift in the lee); an exposed windward crest keeps or boosts it.
    const hUp = calm ? null : terrainElevAt(lon + upE * LU / mLng, lat + upN * LU / mLat);
    const scale = hUp == null ? 1 : Math.max(0.2, Math.min(1.4, 1 - (hUp - hC) / H_SHELTER));
    // Anabatic upslope contribution: heated (sun-facing) slopes lift, ∝ insolation × sun
    // incidence × slope — added to the synoptic wind·∇terrain (uphill = lift).
    const slope = Math.hypot(gx, gy), nl = Math.hypot(gx, gy, 1);
    const cosInc = insol > 0 ? Math.max(0, (su[0] * -gx + su[1] * -gy + su[2]) / nl) : 0;
    const w = (wind[0] * gx + wind[1] * gy) * scale + ANA_GAIN * insol * cosInc * slope;   // synoptic + anabatic (m/s)
    const aw = Math.abs(w);
    if (aw < W_MIN) continue;                                         // near-flat / cross-wind
    const lvl = aw >= 2 ? 2 : aw >= 1 ? 1 : 0;
    addPatch(bins[w > 0 ? lvl : 3 + lvl], lon, lat, hC, gx, gy, half, k, mLng, mLat);   // uphill = lift, downhill = sink
  }
  if (cells < 20) return [];   // terrain not loaded here yet — try again next frame, don't cache

  const meshes = bins.map((b, i) => b.idx.length ? {
    color: COLORS[i],
    mesh: {
      attributes: { POSITION: { value: new Float32Array(b.pos), size: 3 }, NORMAL: { value: new Float32Array(b.nrm), size: 3 } },
      indices: { value: new Uint32Array(b.idx), size: 1 }, mode: 4,
    },
  } : null).filter(Boolean) as { color: number[]; mesh: any }[];
  cache = { cLon, cLat, R, hour, wk, meshes };
  return mkLayers(meshes, alpha);
}
