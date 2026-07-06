// ============ lee waves (mountain wave / onde): resonant lift downwind of ridges ====
// When a stable airstream crosses a ridge with enough wind, it oscillates downwind as a
// standing wave: smooth lift in the crests, sink in the troughs, at the wavelength
//   λ = 2π·U / N                (U = cross-ridge wind, N = Brunt–Väisälä frequency)
// We take the terrain forcing along the wind (w₀ = wind·∇terrain) and convolve the
// UPWIND profile with a decaying sinusoid at the resonant wavenumber l = N/U — a linear,
// illustrative lee-wave response draped on the terrain. The "Onde" component of the lift
// potential (its opacity set by the mixer weight). Rough (see the docs).
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { windBg } from './ridge';
import { getWeather, weatherStability } from './weather';
import { LIFT_COLORS, SINK_COLORS } from './liftviz';

const NG = 60;           // grid nodes per side
const GB = 140;          // terrain-gradient baseline (m)
const OFF = 14;          // patch lift off the surface (m)
const WIND_MIN = 7;      // m/s: weakest cross-ridge wind that makes wave (~25 km/h)
const N_MIN = 0.006;     // 1/s: weakest stability that makes wave
const LAMBDA_MIN = 2500, LAMBDA_MAX = 22000;   // m: plausible lee-wave wavelengths
const W_MIN = 0.4;       // m/s: weakest wave lift / sink drawn
const AMP = 1.6;         // display gain on the linear response
const COLORS = [LIFT_COLORS[0], LIFT_COLORS[2], LIFT_COLORS[4], ...SINK_COLORS];   // 3 lift + 3 sink

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
function addPatch(b: Bin, lon: number, lat: number, hC: number, gx: number, gy: number, half: number, k: number, mLng: number, mLat: number): void {
  const start = b.pos.length / 3;
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const z = (hC + gx * dx + gy * dy + OFF) * k;
    b.pos.push(lon + dx / mLng, lat + dy / mLat, z); b.nrm.push(0, 0, 1);
  }
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
  if (S.source === 'file' || !S.date) return [];
  const wind = windBg(cLat, cLon); if (!wind) return [];
  const spd = Math.hypot(wind[0], wind[1]); if (spd < WIND_MIN) return [];   // too little wind → no wave
  const hour = Math.floor((S.G0 + S.cur) / 3600);
  const wx = getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date);
  const N = wx ? weatherStability(wx, hour) : NaN;
  if (!(N > N_MIN)) return [];                                              // neutral / unstable → no wave
  const l = N / spd, lambda = 2 * Math.PI / l;                             // Scorer wavenumber + wavelength
  if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) return [];
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;
  const R = Math.max(4000, Math.min(20000, mppx * 700));
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * 111320 * cosLat, (cache.cLat - cLat) * 111320);
    if (moved < R * 0.33) return mkLayers(cache.meshes, alpha);
  }
  const mLng = 111320 * Math.cos(cLat * Math.PI / 180), mLat = 111320, sp = (2 * R) / (NG - 1), half = sp * 0.62;
  const nlon = (i: number) => cLon + (-R + i * sp) / mLng, nlat = (j: number) => cLat + (-R + j * sp) / mLat;
  // Pass 1: terrain forcing along the wind, w₀ = wind·∇terrain (m/s), per node.
  const F = new Float32Array(NG * NG), GX = new Float32Array(NG * NG), GY = new Float32Array(NG * NG), HH = new Float32Array(NG * NG), ok = new Uint8Array(NG * NG);
  let ready = 0;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const lon = nlon(i), lat = nlat(j), idx = j * NG + i;
    const hC = terrainElevAt(lon, lat);
    const hE = terrainElevAt(lon + GB / mLng, lat), hW = terrainElevAt(lon - GB / mLng, lat);
    const hN = terrainElevAt(lon, lat + GB / mLat), hS = terrainElevAt(lon, lat - GB / mLat);
    if (hC == null || hE == null || hW == null || hN == null || hS == null) continue;
    const gx = (hE - hW) / (2 * GB), gy = (hN - hS) / (2 * GB);
    F[idx] = wind[0] * gx + wind[1] * gy; GX[idx] = gx; GY[idx] = gy; HH[idx] = hC; ok[idx] = 1; ready++;
  }
  if (ready < NG * NG * 0.4) return [];   // terrain not loaded here yet — retry next frame
  // Pass 2: convolve the upwind forcing with a decaying resonant sinusoid → wave w.
  const uE = -wind[0] / spd, uN = -wind[1] / spd;                          // upwind unit vector
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
    addPatch(bins[w > 0 ? lvl : 3 + lvl], nlon(i), nlat(j), HH[idx], GX[idx], GY[idx], half, k, mLng, mLat);
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
