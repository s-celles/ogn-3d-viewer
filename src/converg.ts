// ============ convergence lines: lift where the low-level wind piles up ============
// Wind deflected by terrain converges at valley heads, bowls and terrain confluences
// facing the flow, and diverges in the lee — real, often strong, lift/sink that slope
// lift misses (slope lift ∝ terrain gradient; convergence ∝ terrain *curvature*). We
// deflect a uniform background wind around the DEM (remove its into-slope component),
// then drape the horizontal divergence of that field: convergence warm (rising), lee
// divergence blue (sinking). The "Convergence" component of the lift potential — its
// opacity set by the mixer weight. Rough and illustrative (see the docs).
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { windBg } from './ridge';
import { sunLightDir, sceneMs } from './sky';
import { getLC, sampleGrid, lcVersion } from './landcover';
import { wxEpoch } from './weather';
import { LIFT_COLORS, SINK_COLORS } from './core/liftviz';

const NG = 64;           // grid nodes per side
const GB = 110;          // terrain-gradient baseline (m)
const OFF = 12;          // patch lift off the surface (m) — avoid z-fighting
const ALPHA = 0.85;      // how strongly terrain blocks the into-slope wind component
const CONV_MIN = 0.05;   // min |normalised divergence| drawn
const CONV_FRAC = [0.12, 0.22];   // sub-levels (3 colours per side)
// Lake/sea breeze: on a sunny day the cool water and warm land drive a breeze from water to
// land, converging (lift) just inland of the shore and sinking over the water. Modelled from
// the curvature of a smoothed water-cover field, scaled by insolation, damped by strong wind.
const LB_GAIN = 2.5;     // lake-breeze convergence gain (× insolation × water-field curvature)
const LB_BLUR = 5;       // cells: blur radius of the water field → how far the breeze reaches inland
const LB_WATER = 0.12;   // land-cover sensible fraction below this ⇒ a water cell
const INSOL_REF = 0.25;  // sin(sun elevation) at which the land–water heating contrast saturates
// Separable box blur (radius r) of an NG×NG field — smooths the water mask.
function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii < 0 || ii >= n) continue; s += src[j * n + ii]; c++; } tmp[j * n + i] = s / c; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj < 0 || jj >= n) continue; s += tmp[jj * n + i]; c++; } out[j * n + i] = s / c; }
  return out;
}
// Shared lift ramp: convergence (rising) warm, divergence (sinking) cool blue.
const COLORS = [LIFT_COLORS[0], LIFT_COLORS[2], LIFT_COLORS[4], ...SINK_COLORS];   // 3 conv + 3 div

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
// A slope-following quad at a cell, tilted by the local gradient (so bands lie on the ground).
function addPatch(b: Bin, lon: number, lat: number, hC: number, gx: number, gy: number, half: number, k: number, mLng: number, mLat: number): void {
  const start = b.pos.length / 3;
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const z = (hC + gx * dx + gy * dy + OFF) * k;
    b.pos.push(lon + dx / mLng, lat + dy / mLat, z); b.nrm.push(0, 0, 1);
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
  const spd = Math.hypot(wind[0], wind[1]);
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;
  const R = Math.max(4000, Math.min(20000, mppx * 700));
  // Lake-breeze source: the sun's heating contrast + a water mask (only fetched by day).
  const ld = sunLightDir(sceneMs(), cLat, cLon);
  const insol = Number.isFinite(ld[2]) ? Math.max(0, Math.min(1, -ld[2] / INSOL_REF)) : 0;
  const lc = insol > 0 && S.source !== 'file' ? getLC(cLat, cLon, R) : null;
  if (spd < 1.5 && !lc) return [];   // calm AND no lake-breeze source → nothing
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}|${lc ? lcVersion() : -1}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * 111320 * cosLat, (cache.cLat - cLat) * 111320);
    if (moved < R * 0.33) return mkLayers(cache.meshes, alpha);
  }
  const mLng = 111320 * Math.cos(cLat * Math.PI / 180), mLat = 111320, sp = (2 * R) / (NG - 1), half = sp * 0.62;
  const nlon = (i: number) => cLon + (-R + i * sp) / mLng, nlat = (j: number) => cLat + (-R + j * sp) / mLat;
  // Pass 1: deflect the wind around the terrain (remove its into-slope component) — a
  // planar slope just turns the flow, but where slopes *converge* the flow decelerates.
  const U = new Float32Array(NG * NG), Vv = new Float32Array(NG * NG);
  const GX = new Float32Array(NG * NG), GY = new Float32Array(NG * NG), HH = new Float32Array(NG * NG), ok = new Uint8Array(NG * NG);
  let ready = 0;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const lon = nlon(i), lat = nlat(j), idx = j * NG + i;
    const hC = terrainElevAt(lon, lat);
    const hE = terrainElevAt(lon + GB / mLng, lat), hW = terrainElevAt(lon - GB / mLng, lat);
    const hN = terrainElevAt(lon, lat + GB / mLat), hS = terrainElevAt(lon, lat - GB / mLat);
    if (hC == null || hE == null || hW == null || hN == null || hS == null) continue;
    const gx = (hE - hW) / (2 * GB), gy = (hN - hS) / (2 * GB), g2 = gx * gx + gy * gy;
    const proj = g2 > 1e-9 ? (wind[0] * gx + wind[1] * gy) / g2 : 0;   // V·ĝ / |g|
    const kk = proj > 0 ? ALPHA * proj : 0;                            // remove the uphill inflow only
    U[idx] = wind[0] - kk * gx; Vv[idx] = wind[1] - kk * gy;
    GX[idx] = gx; GY[idx] = gy; HH[idx] = hC; ok[idx] = 1; ready++;
  }
  if (ready < NG * NG * 0.4) return [];   // terrain not loaded here yet — retry next frame, don't cache
  // Pass 2: horizontal divergence, normalised (dimensionless: fraction of the wind lost
  // per cell) so it's view-independent. Convergence = −divergence.
  const norm = sp / Math.max(spd, 1), invS = 1 / (2 * sp);
  const Cn = new Float32Array(NG * NG).fill(NaN);
  for (let j = 1; j < NG - 1; j++) for (let i = 1; i < NG - 1; i++) {
    const idx = j * NG + i;
    if (!ok[idx] || !ok[idx + 1] || !ok[idx - 1] || !ok[idx + NG] || !ok[idx - NG]) continue;
    const div = (U[idx + 1] - U[idx - 1]) * invS + (Vv[idx + NG] - Vv[idx - NG]) * invS;   // ∂u/∂x + ∂v/∂y
    Cn[idx] = -div * norm;
  }
  // Lake/sea breeze: curvature of a smoothed water-cover field → convergence (lift) just
  // inland of the shore, subsidence over the water; scaled by insolation, damped by wind.
  if (lc) {
    const { sens } = sampleGrid(lc, cLat, cLon, R, NG);
    const wm = new Float32Array(NG * NG);
    for (let idx = 0; idx < NG * NG; idx++) wm[idx] = sens[idx] < LB_WATER ? 1 : 0;
    const wS = boxBlur(wm, NG, LB_BLUR);
    const damp = Math.max(0.2, Math.min(1, 1 - (spd - 3) / 9));   // strong synoptic wind washes the breeze out
    for (let j = 1; j < NG - 1; j++) for (let i = 1; i < NG - 1; i++) {
      const idx = j * NG + i; if (!ok[idx]) continue;
      const lap = wS[idx + 1] + wS[idx - 1] + wS[idx + NG] + wS[idx - NG] - 4 * wS[idx];   // land-side shore: +, over water: −
      Cn[idx] = (Number.isNaN(Cn[idx]) ? 0 : Cn[idx]) + LB_GAIN * insol * damp * lap;
    }
  }
  // Pass 3: light 3×3 blur (curvature is noisier than gradient) then bin + drape.
  const bins: Bin[] = [0, 1, 2, 3, 4, 5].map(() => ({ pos: [], nrm: [], idx: [] }));   // 0-2 conv, 3-5 div
  for (let j = 1; j < NG - 1; j++) for (let i = 1; i < NG - 1; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const v = Cn[(j + dj) * NG + (i + di)]; if (!Number.isNaN(v)) { s += v; n++; }
    }
    if (!n) continue;
    const c = s / n, ac = Math.abs(c);
    if (ac < CONV_MIN) continue;
    let lvl = 0; while (lvl < CONV_FRAC.length && ac >= CONV_FRAC[lvl]) lvl++;
    const idx = j * NG + i;
    addPatch(bins[c > 0 ? lvl : 3 + lvl], nlon(i), nlat(j), HH[idx], GX[idx], GY[idx], half, k, mLng, mLat);
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
