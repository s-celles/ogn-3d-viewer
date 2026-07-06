// ============ lee waves (mountain wave / onde): resonant lift downwind of ridges ====
// When a stable airstream crosses a ridge with enough wind, it oscillates downwind as a
// standing wave: smooth lift in the crests, sink in the troughs, at the wavelength
//   λ = 2π·U / N                (U = cross-ridge wind, N = Brunt–Väisälä frequency)
// We take the terrain forcing along the wind (w₀ = wind·∇terrain) and convolve the
// UPWIND profile with a decaying sinusoid at the resonant wavenumber l = N/U — a linear,
// illustrative lee-wave response. Because the wave is an ELEVATED phenomenon, the bands
// are drawn as vertical curtains at altitude (⟂ the wind, above the ridges), not draped
// on the ground. The "Onde" component of the lift potential. Rough (see the docs).
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { windBg } from './ridge';
import { getWeather, weatherStability, wxEpoch } from './weather';
import { LIFT_COLORS, SINK_COLORS } from './liftviz';

const NG = 60;           // grid nodes per side
const GB = 140;          // terrain-gradient baseline (m)
const WIND_MIN = 7;      // m/s: weakest cross-ridge wind that makes wave (~25 km/h)
const N_MIN = 0.006;     // 1/s: weakest stability that makes wave
const LAMBDA_MIN = 2000, LAMBDA_MAX = 35000;   // m: plausible lee-wave wavelengths (wide, so strong wind keeps a wave)
const W_MIN = 0.4;       // m/s: weakest wave lift / sink drawn
const AMP = 1.6;         // display gain on the linear response
const WAVE_BASE = 100;   // m: curtains start this far above the highest ridge
const WAVE_TOP = 2600;   // m: curtain height above its base (the wave is elevated, not on the ground)
const COLORS = [LIFT_COLORS[0], LIFT_COLORS[2], LIFT_COLORS[4], ...SINK_COLORS];   // 3 lift + 3 sink

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
// A VERTICAL curtain at a cell, along the crest (⟂ wind), from zBase to zTop — the wave
// is an elevated phenomenon, so we raise the bands to altitude instead of draping them.
function addCurtain(b: Bin, lon: number, lat: number, cE: number, cN: number, half: number, zBase: number, zTop: number, mLng: number, mLat: number): void {
  const start = b.pos.length / 3, dLon = cE * half / mLng, dLat = cN * half / mLat;
  b.pos.push(lon - dLon, lat - dLat, zBase, lon + dLon, lat + dLat, zBase, lon + dLon, lat + dLat, zTop, lon - dLon, lat - dLat, zTop);
  for (let n = 0; n < 4; n++) b.nrm.push(0, 0, 1);
  b.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

const mkLayers = (meshes: { color: number[]; mesh: any }[], alpha: number): any[] => meshes.map((m, i) => new SimpleMeshLayer({
  id: 'wave-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
  coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [m.color[0], m.color[1], m.color[2], Math.round(m.color[3] * alpha)],
  material: false, parameters: meshParams, mesh: m.mesh,
} as any));

let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; meshes: { color: number[]; mesh: any }[] } | null = null;

export function waveLayers(k: number, alpha = 1): any[] {
  if (alpha <= 0) return [];
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  if (!S.wxSim.on && (S.source === 'file' || !S.date)) return [];
  const wind = windBg(cLat, cLon); if (!wind) return [];
  const spd = Math.hypot(wind[0], wind[1]); if (spd < WIND_MIN) return [];   // too little wind → no wave
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wx = getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date);
  const N = wx ? weatherStability(wx, hour) : NaN;
  if (!(N > N_MIN)) return [];                                              // neutral / unstable → no wave
  const l = N / spd, lambda = 2 * Math.PI / l;                             // Scorer wavenumber + wavelength
  if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) return [];
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;
  const R = Math.max(4000, Math.min(20000, mppx * 700));
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * 111320 * cosLat, (cache.cLat - cLat) * 111320);
    if (moved < R * 0.33) return mkLayers(cache.meshes, alpha);
  }
  const mLng = 111320 * Math.cos(cLat * Math.PI / 180), mLat = 111320, sp = (2 * R) / (NG - 1), half = sp * 0.62;
  const nlon = (i: number) => cLon + (-R + i * sp) / mLng, nlat = (j: number) => cLat + (-R + j * sp) / mLat;
  // Pass 1: terrain forcing along the wind, w₀ = wind·∇terrain (m/s), per node; and the
  // highest ridge, so the elevated curtains sit above the terrain.
  const F = new Float32Array(NG * NG), ok = new Uint8Array(NG * NG);
  let ready = 0, maxTerr = -Infinity;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const lon = nlon(i), lat = nlat(j), idx = j * NG + i;
    const hC = terrainElevAt(lon, lat);
    const hE = terrainElevAt(lon + GB / mLng, lat), hW = terrainElevAt(lon - GB / mLng, lat);
    const hN = terrainElevAt(lon, lat + GB / mLat), hS = terrainElevAt(lon, lat - GB / mLat);
    if (hC == null || hE == null || hW == null || hN == null || hS == null) continue;
    F[idx] = wind[0] * (hE - hW) / (2 * GB) + wind[1] * (hN - hS) / (2 * GB); ok[idx] = 1; ready++;
    if (hC > maxTerr) maxTerr = hC;
  }
  if (ready < NG * NG * 0.4) return [];   // terrain not loaded here yet — retry next frame
  // Pass 2: convolve the upwind forcing with a decaying resonant sinusoid → wave w.
  const uE = -wind[0] / spd, uN = -wind[1] / spd;                          // upwind unit vector
  const cE = -wind[1] / spd, cN = wind[0] / spd;                           // crest direction (⟂ wind)
  const zBase = (maxTerr + WAVE_BASE) * k, zTop = (maxTerr + WAVE_BASE + WAVE_TOP) * k;   // elevated band
  const Ld = 2.5 * lambda, Lmax = Math.min(3 * lambda, R * 1.7), stepM = lambda / 9;
  const bins: Bin[] = [0, 1, 2, 3, 4, 5].map(() => ({ pos: [], nrm: [], idx: [] }));   // 0-2 lift, 3-5 sink
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const idx = j * NG + i; if (!ok[idx]) continue;
    let w = 0;
    for (let s = stepM; s <= Lmax; s += stepM) {
      const si = Math.round(i + uE * s / sp), sj = Math.round(j + uN * s / sp);
      if (si < 0 || si >= NG || sj < 0 || sj >= NG) break;
      const fi = sj * NG + si; if (!ok[fi]) continue;
      w += F[fi] * Math.sin(l * s) * Math.exp(-s / Ld);
    }
    w *= AMP * stepM / lambda;                                             // normalise the integral
    const aw = Math.abs(w); if (aw < W_MIN) continue;
    const lvl = aw >= 2 ? 2 : aw >= 1 ? 1 : 0;
    addCurtain(bins[w > 0 ? lvl : 3 + lvl], nlon(i), nlat(j), cE, cN, half, zBase, zTop, mLng, mLat);
  }
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
