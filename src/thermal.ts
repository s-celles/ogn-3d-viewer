// ============ thermal potential: an estimated updraft (Vz) field from physics ====
// Where does the ground heat the air enough to make thermals? We take the incoming
// sun on each terrain facet (sun geometry × slope aspect from the DEM), turn it into
// a sensible heat flux (absorbed = flux·(1−albedo), a sensible fraction of that),
// then the convective velocity scale w* = [ (g/θ)·(H/ρcp)·z_i ]^(1/3) with the
// boundary-layer depth z_i from the weather. Vz ≈ 0.6·w*. A coarse, illustrative
// diagnostic (uniform albedo/Bowen for now, no advection/cloud shading) — see docs.
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { sunLightDir } from './sky';
import { getWeather, weatherRad } from './weather';
import { getLC, sampleGrid, lcVersion } from './landcover';
import { windBg } from './ridge';
import { LIFT_COLORS as VZ_COLORS } from './liftviz';

const GN = 80;           // grid nodes per side (map resolution)
const GRAD = 80;         // slope-gradient baseline (m) — short, for the true local slope
const OFF = 26;          // drape offset (m) — float above the fine terrain, no sinking/holes
const ALBEDO = 0.2;      // uniform surface albedo (land-cover refinement: later)
const BETA = 0.35;       // sensible-heat fraction of the absorbed flux (Bowen + ground)
const G = 9.81, THETA = 290, RHOCP = 1200;   // gravity, ref pot. temp (K), ρ·cp (J/m³K)
// Vz bins (m/s) → one mesh each: blue (weak) → red (strong).
// Highlight only the better-exposed cells (relative to the view), on the shared warm
// lift ramp; transparent below VZ_MIN so weak areas show clean terrain.
const VZ_MIN = 0.62;     // draw cells above this fraction of the view's 95th-pct value
const VZ_FRAC = [0.62, 0.74, 0.85, 0.94];   // sub-levels within [VZ_MIN, 1]
const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface TNode { h: number; gx: number; gy: number }   // elevation + terrain gradient (m/m)
interface TGrid { cLon: number; cLat: number; R: number; mLng: number; mLat: number; sp: number; nodes: TNode[] }

// Terrain grid (elevation + gradients), cached per view — the DEM part is the
// expensive bit and does not change with time.
let terr: TGrid | null = null;
function ensureTerr(cLat: number, cLon: number, R: number): TGrid | null {
  const mLng = 111320 * Math.cos(cLat * Math.PI / 180), mLat = 111320, sp = (2 * R) / (GN - 1);
  if (terr && Math.abs(Math.log(terr.R / R)) < 0.25
    && Math.hypot((terr.cLon - cLon) * terr.mLng, (terr.cLat - cLat) * terr.mLat) < R * 0.33) return terr;
  const nodes: TNode[] = new Array(GN * GN);
  let ready = 0;
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const lon = cLon + (-R + i * sp) / mLng, lat = cLat + (-R + j * sp) / mLat;
    const h = terrainElevAt(lon, lat);
    const hE = terrainElevAt(lon + GRAD / mLng, lat), hW = terrainElevAt(lon - GRAD / mLng, lat);
    const hN = terrainElevAt(lon, lat + GRAD / mLat), hS = terrainElevAt(lon, lat - GRAD / mLat);
    if (h == null || hE == null || hW == null || hN == null || hS == null) { nodes[j * GN + i] = { h: NaN, gx: 0, gy: 0 }; continue; }
    ready++;
    nodes[j * GN + i] = { h, gx: (hE - hW) / (2 * GRAD), gy: (hN - hS) / (2 * GRAD) };   // slope over a short baseline, not the coarse grid step
  }
  if (ready < GN * GN * 0.4) return null;   // terrain not loaded yet
  return (terr = { cLon, cLat, R, mLng, mLat, sp, nodes });
}

// Per-node albedo + sensible fraction from OSM land-cover (null → uniform defaults),
// cached per terrain grid and land-cover version.
let lcCache: { terr: TGrid; lcv: number; alb: Float32Array | null; sens: Float32Array | null } | null = null;
function lcParams(g: TGrid, cLat: number, cLon: number, R: number): { alb: Float32Array | null; sens: Float32Array | null; lcv: number } {
  const lc = S.source !== 'file' ? getLC(cLat, cLon, R) : null;
  const lcv = lc ? lcVersion() : -1;
  if (!lcCache || lcCache.terr !== g || lcCache.lcv !== lcv) {
    const r = lc ? sampleGrid(lc, cLat, cLon, R, GN) : { alb: null, sens: null };
    lcCache = { terr: g, lcv, alb: r.alb, sens: r.sens };
  }
  return { alb: lcCache.alb, sens: lcCache.sens, lcv };
}

// Replay instant (ms UTC) for the sun position.
const nowMs = (): number => Date.parse(S.date + 'T00:00:00Z') + (S.G0 + S.cur) * 1000;

let cache: { terr: TGrid; k: number; bucket: number; wxr: boolean; lcv: number; blend: number; meshes: { color: number[]; mesh: any }[] } | null = null;

/** Draped patches coloured by the estimated thermal updraft (Vz), from sun × slope
 *  × heat flux × w*. Empty at night or when the terrain/date is unavailable. */
export function thermalLayers(k: number): any[] {
  if (!S.date || !Number.isFinite(nowMs())) return [];
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const R = Math.max(4000, Math.min(20000, 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom * 700));
  const g = ensureTerr(cLat, cLon, R); if (!g) return [];
  // Sun: unit vector toward the sun (ENU); light-travel dir is its negation.
  const ld = sunLightDir(nowMs(), cLat, cLon), su: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
  if (su[2] <= 0.02) return [];   // sun at/below the horizon → no thermals
  // Radiation + boundary-layer depth from the weather (else nominal clear-sky values).
  const wx = S.source !== 'file' ? getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date) : null;
  const rad = wx ? weatherRad(wx, Math.floor((S.G0 + S.cur) / 3600)) : { sw: NaN, diff: NaN, blh: NaN };
  const diff = Number.isFinite(rad.diff) ? rad.diff : 90;
  const dni = Math.min(1050, Math.max(0, ((Number.isFinite(rad.sw) ? rad.sw : 1000 * su[2]) - diff)) / su[2]);   // direct normal irradiance
  const zi = Number.isFinite(rad.blh) && rad.blh > 200 ? rad.blh : 1500;

  const lcp = lcParams(g, cLat, cLon, R);
  const wind = windBg(cLat, cLon);   // for the slope-lift term of the combined field
  const blend = S.liftBlend;         // 0 = pure thermal, 1 = pure slope lift
  const bucket = Math.floor((S.G0 + S.cur) / 900);   // recompute every ~15 min of sim time
  if (!cache || cache.terr !== g || cache.k !== k || cache.bucket !== bucket || cache.wxr !== !!wx || cache.lcv !== lcp.lcv || cache.blend !== blend) {
    const bins = VZ_COLORS.map(() => ({ pos: [] as number[], nrm: [] as number[], idx: [] as number[] }));
    const nlon = (i: number) => g.cLon + (-g.R + i * g.sp) / g.mLng, nlat = (j: number) => g.cLat + (-g.R + j * g.sp) / g.mLat;
    // Vz per node: sun incidence on the slope × heat flux (albedo + sensible fraction
    // from land-cover, else uniform) → w*.
    const alb = lcp.alb, sens = lcp.sens, wu = wind ? wind[0] : 0, wv = wind ? wind[1] : 0, vzN = new Float32Array(GN * GN);
    for (let idx = 0; idx < GN * GN; idx++) {
      const n = g.nodes[idx];
      if (Number.isNaN(n.h)) { vzN[idx] = NaN; continue; }
      const nl = Math.hypot(n.gx, n.gy, 1);
      const cosInc = Math.max(0, (su[0] * -n.gx + su[1] * -n.gy + su[2]) / nl);
      const H = (dni * cosInc + diff) * (1 - (alb ? alb[idx] : ALBEDO)) * (sens ? sens[idx] : BETA);
      const thermal = 0.6 * Math.cbrt((G / THETA) * (H / RHOCP) * zi);   // thermal updraft (m/s)
      const slope = Math.max(0, wu * n.gx + wv * n.gy);                  // windward slope lift (m/s)
      vzN[idx] = (1 - blend) * thermal + blend * slope;                  // combined lift potential
    }
    // Per-cell Vz into a 2D grid, then a light 3×3 blur — kills the bin checkerboard.
    const NW = GN - 1, W = new Float32Array(NW * NW).fill(NaN);
    for (let j = 0; j < NW; j++) for (let i = 0; i < NW; i++) {
      const va = vzN[j * GN + i], vb = vzN[j * GN + i + 1], vc = vzN[(j + 1) * GN + i], vd = vzN[(j + 1) * GN + i + 1];
      if (!Number.isNaN(va) && !Number.isNaN(vb) && !Number.isNaN(vc) && !Number.isNaN(vd)) W[j * NW + i] = (va + vb + vc + vd) / 4;
    }
    const Ws = new Float32Array(NW * NW).fill(NaN);
    for (let j = 0; j < NW; j++) for (let i = 0; i < NW; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = j + dj, ii = i + di; if (jj < 0 || jj >= NW || ii < 0 || ii >= NW) continue;
        const v = W[jj * NW + ii]; if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (n) Ws[j * NW + i] = s / n;
    }
    const vals = [...Ws].filter(v => !Number.isNaN(v)).sort((x, y) => x - y);
    const vmax = Math.max(0.3, vals[Math.floor(vals.length * 0.95)] || 1);   // 95th pct → relative scale
    for (let j = 0; j < NW; j++) for (let i = 0; i < NW; i++) {
      const w = Ws[j * NW + i]; if (Number.isNaN(w)) continue;
      const f = w / vmax; if (f < VZ_MIN) continue;   // weak → transparent (clean terrain)
      const a = g.nodes[j * GN + i], b = g.nodes[j * GN + i + 1], cc = g.nodes[(j + 1) * GN + i], d = g.nodes[(j + 1) * GN + i + 1];
      let bin = 0; while (bin < VZ_FRAC.length && f >= VZ_FRAC[bin]) bin++;
      const B = bins[bin], st = B.pos.length / 3;
      const P = (ii: number, jj: number, h: number) => { B.pos.push(nlon(ii), nlat(jj), h * k + OFF); B.nrm.push(0, 0, 1); };
      P(i, j, a.h); P(i + 1, j, b.h); P(i + 1, j + 1, d.h); P(i, j + 1, cc.h);
      B.idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
    }
    const meshes = bins.map((B, i) => B.idx.length ? {
      color: VZ_COLORS[i],
      mesh: {
        attributes: { POSITION: { value: new Float32Array(B.pos), size: 3 }, NORMAL: { value: new Float32Array(B.nrm), size: 3 } },
        indices: { value: new Uint32Array(B.idx), size: 1 }, mode: 4,
      },
    } : null).filter(Boolean) as { color: number[]; mesh: any }[];
    cache = { terr: g, k, bucket, wxr: !!wx, lcv: lcp.lcv, blend, meshes };
  }
  return cache.meshes.map((m, i) => new SimpleMeshLayer({
    id: 'thermal-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: m.color, material: false, parameters: meshParams, mesh: m.mesh,
  } as any));
}
