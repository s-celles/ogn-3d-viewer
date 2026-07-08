// ============ thermal potential: an estimated updraft (Vz) field from physics ====
// Where does the ground heat the air enough to make thermals? We take the incoming
// sun on each terrain facet (sun geometry × slope aspect from the DEM, minus any
// cast shadow from upwind relief), turn it into a sensible heat flux (absorbed =
// flux·(1−albedo), a sensible fraction of that), then the convective velocity scale
// w* = [ (g/θ)·(H/ρcp)·z_i ]^(1/3) with the boundary-layer depth z_i from the weather.
// Each cell is shown as its fractional anomaly vs a flat reference patch (view-
// independent). A coarse, illustrative diagnostic (no advection/cloud shading) — docs.
import { S } from './state';
import { SimpleMeshLayer, IconLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { sunLightDir, sceneMs } from './sky';
import { getWeather, weatherRad, weatherConvTop, weatherCloudbase, weatherWind, wxEpoch } from './weather';
import { cloudSprite } from './airmass';
import { getLC, sampleGrid, lcVersion } from './landcover';
import { liftCalibration } from './calib';
import { LIFT_COLORS as VZ_COLORS, SINK_COLORS } from './liftviz';

const GN = 80;           // grid nodes per side (map resolution)
const GRAD = 80;         // slope-gradient baseline (m) — short, for the true local slope
const OFF = 26;          // drape offset (m) — float above the fine terrain, no sinking/holes
const ALBEDO = 0.2;      // uniform surface albedo (land-cover refinement: later)
const SNOW_ALB = 0.72;   // albedo of snow cover — reflects most of the sun, so it barely heats
const SNOW_MID = 2100, SNOW_AMP = 1100, SNOW_BAND = 300;   // m: seasonal snow line (mid ± amplitude) and its blend width
// Seasonal snow line (m): high in summer, low in winter; flipped in the southern hemisphere.
function snowLineM(ms: number, lat: number): number {
  const d = new Date(ms);
  let doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  if (lat < 0) doy = (doy + 182.5) % 365;
  return SNOW_MID + SNOW_AMP * Math.cos(2 * Math.PI * (doy - 200) / 365);   // peaks ~late July (NH)
}
const BETA = 0.35;       // sensible-heat fraction of the absorbed flux (Bowen + ground)
const TRIG_GAIN = 0.4;   // convex-break trigger: ± bias on the heated field from topographic position
const TPI_REF = 18;      // m: TPI (height above the local mean) that saturates the trigger bias
const STREET_RATIO = 2.7;   // across-wind cloud-street spacing ≈ this × the convective depth z_i
const STREET_ZI_MIN = 800;  // m: minimum convective depth for streets to organise
const STREET_WIND_MIN = 4;  // m/s: minimum boundary-layer wind for streets
const STREET_AMP = 0.5;     // ± modulation of the heat flux along / between the streets
const STORE_GAIN = 1.4;  // strength of the diurnal heat storage/restitution modulation (× S.heatStore × inertia)
const TAU_H = 2.6;       // h: ground heat-storage time constant (the lag before stored heat is released)
const IREF = 0.4;        // reference-ground inertia (the flat reference gets the same diurnal modulation)
const G = 9.81, THETA = 290, RHOCP = 1200;   // gravity, ref pot. temp (K), ρ·cp (J/m³K)
// Vz bins (m/s) → one mesh each: blue (weak) → red (strong).
// Highlight only the better-exposed cells (relative to the view), on the shared warm
// lift ramp; transparent below VZ_MIN so weak areas show clean terrain.
// Colour is view-independent: WARM tracks the *absolute* updraught strength Vz (so a
// strong midday thermal is red everywhere it's strong, not just where aspect beats the
// average), BLUE tracks how far a cell falls *below* the flat-ground reference (shaded
// / poorly-exposed faces — the compensating subsidence, by mass continuity).
const W_FULL = 1.5;      // Vz (m/s) that maps to full red
const WARM_MIN = 0.30;   // draw warm above this fraction of W_FULL (≈ Vz 0.45 m/s)
const WARM_FRAC = [0.45, 0.6, 0.75, 0.9];    // f = Vz/W_FULL sub-levels (5 warm colours, red ≥ last)
const SINK_MIN = 0.12;   // draw blue below −this fraction of the reference (deficit)
const SINK_FRAC = [0.24, 0.42];              // deficit sub-levels (3 SINK_COLORS)
const COLORS = [...VZ_COLORS, ...SINK_COLORS];   // 5 warm (lift) + 3 cool (sink)
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
let lcCache: { terr: TGrid; lcv: number; alb: Float32Array | null; sens: Float32Array | null; iner: Float32Array | null } | null = null;
function lcParams(g: TGrid, cLat: number, cLon: number, R: number): { alb: Float32Array | null; sens: Float32Array | null; iner: Float32Array | null; lcv: number } {
  const lc = S.source !== 'file' ? getLC(cLat, cLon, R) : null;
  const lcv = lc ? lcVersion() : -1;
  if (!lcCache || lcCache.terr !== g || lcCache.lcv !== lcv) {
    const r = lc ? sampleGrid(lc, cLat, cLon, R, GN) : { alb: null, sens: null, iner: null };
    lcCache = { terr: g, lcv, alb: r.alb, sens: r.sens, iner: r.iner };
  }
  return { alb: lcCache.alb, sens: lcCache.sens, iner: lcCache.iner, lcv };
}

// Diurnal ground heat storage: a first-order reservoir lagging the day's solar forcing,
// so heat absorbed around midday is released in the late afternoon. Returns ΔM at the
// current time = (reservoir − instantaneous forcing) / peak forcing — negative in the
// morning (ground charging → thermals damped / late), positive in the late afternoon
// (ground releasing → thermals boosted / prolonged). Cheap: 24 sun-elevation samples.
function diurnalStore(nowMsVal: number, cLat: number, cLon: number): number {
  const DAY = 86400000, dayStart = Math.floor(nowMsVal / DAY) * DAY;
  const F = new Float64Array(24); let Fmax = 0;
  for (let h = 0; h < 24; h++) { const ld = sunLightDir(dayStart + h * 3600000, cLat, cLon); const f = Math.max(0, -ld[2]); F[h] = f; if (f > Fmax) Fmax = f; }
  if (Fmax <= 1e-4) return 0;                                   // polar night → no cycle
  const a = 1 - Math.exp(-1 / TAU_H);
  const Sr = new Float64Array(24); let s = 0;
  for (let pass = 0; pass < 3; pass++) for (let h = 0; h < 24; h++) { s += a * (F[h] - s); Sr[h] = s; }   // spin up to a periodic day
  const hf = ((nowMsVal - dayStart) / 3600000) % 24, h0 = Math.floor(hf), h1 = (h0 + 1) % 24, fr = hf - h0;
  const Ff = F[h0] + (F[h1] - F[h0]) * fr, Sf = Sr[h0] + (Sr[h1] - Sr[h0]) * fr;
  return (Sf - Ff) / Fmax;
}

// Instant (ms UTC) for the sun — shared with the scene lighting (sandbox-aware).
const nowMs = sceneMs;

interface Puff { pos: [number, number, number]; size: number }
let cache: { terr: TGrid; k: number; bucket: number; wxr: boolean; lcv: number; cal: number; wxe: number; hs: number; meshes: { color: number[]; mesh: any }[]; cu: Puff[] } | null = null;

/** Draped patches coloured by the estimated thermal updraft (Vz), from sun × slope
 *  × heat flux × w*. Empty at night or when the terrain/date is unavailable. */
export function thermalLayers(k: number, alpha = 1): any[] {
  if (alpha <= 0 || !Number.isFinite(nowMs())) return [];
  if (!S.wxSim.on && !S.date) return [];
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const R = Math.max(4000, Math.min(20000, 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom * 700));
  const g = ensureTerr(cLat, cLon, R); if (!g) return [];
  // Sun: unit vector toward the sun (ENU); light-travel dir is its negation.
  const ld = sunLightDir(nowMs(), cLat, cLon), su: [number, number, number] = [-ld[0], -ld[1], -ld[2]];
  if (su[2] <= 0.02) return [];   // sun at/below the horizon → no thermals
  // Radiation + boundary-layer depth from the weather (else nominal clear-sky values).
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wx = (S.wxSim.on || S.source !== 'file') ? getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date) : null;
  const rad = wx ? weatherRad(wx, hour) : { sw: NaN, diff: NaN, blh: NaN };
  const diff = Number.isFinite(rad.diff) ? rad.diff : 90;
  const dni = Math.min(1050, Math.max(0, ((Number.isFinite(rad.sw) ? rad.sw : 1000 * su[2]) - diff)) / su[2]);   // direct normal irradiance
  // Convective depth z_i per cell: the thermal ceiling (parcel vs sounding, else the BL
  // top) minus the ground height — so thermals are deeper over low ground, fade on a
  // stable day, and stop where a peak pokes above the boundary layer.
  const topA = wx ? weatherConvTop(wx, hour) : NaN;
  // Cumulus vs blue: cloud forms if dry convection (the ceiling) reaches the LCL
  // (cloudbase). On a cu day we mark the strong thermal cores with cumulus at the base.
  const cloudbase = wx ? weatherCloudbase(wx, hour) : null;
  const isCu = cloudbase != null && Number.isFinite(topA) && topA >= cloudbase + 80;
  const ziFallback = Number.isFinite(rad.blh) && rad.blh > 200 ? rad.blh : 1500;
  const ziAt = (h: number): number => Math.max(0, Math.min(3500, Number.isFinite(topA) ? topA - h : ziFallback));
  // View-independent reference: the updraught a FLAT patch of reference ground gets
  // under this sun/weather. Each cell is coloured by how strong it is / how far below
  // this it falls — so a given slope keeps its colour no matter where the camera looks.
  // Day-scale calibration from the observed climbs (1 without enough tracks): grounds
  // the absolute magnitude in the day's real thermals — red then means "as strong as
  // the day's best climbs". A uniform factor, so it changes intensity, not the pattern.
  const cal = liftCalibration();
  const wStar = (H: number, zi: number): number => cal * 0.6 * Math.cbrt((G / THETA) * (H / RHOCP) * zi);
  const gRef = terrainElevAt(cLon, cLat);
  // Diurnal heat storage: each surface's inertia sets how much its heating lags the sun
  // and lingers into the late afternoon (rock/urban keep pumping; dry fields collapse).
  const dM = S.heatStore > 0 ? diurnalStore(nowMs(), cLat, cLon) : 0;
  const snowLine = snowLineM(nowMs(), cLat);   // above it, snow albedo shuts thermals down
  // Cloud streets: with enough boundary-layer wind and convective depth, thermals organise
  // into rolls aligned with the wind, spaced ~STREET_RATIO×z_i — lift on the street lines,
  // subsidence between. Modulate the heat flux across-wind (a redistribution, mean ≈ 1).
  const gRefH = gRef != null ? gRef : (S.AF ? S.AF.elev : 0), ziRef = ziAt(gRefH);
  let stK = 0, stAmp = 0, stPE = 0, stPN = 0;
  const stWind = wx && ziRef > STREET_ZI_MIN ? weatherWind(wx, hour, gRefH + Math.max(400, ziRef * 0.5)) : null;
  if (stWind) {
    const ws = Math.hypot(stWind[0], stWind[1]);
    if (ws > STREET_WIND_MIN) {
      stPE = -stWind[1] / ws; stPN = stWind[0] / ws;   // unit ⟂ to the wind (across-street)
      stK = 2 * Math.PI / (STREET_RATIO * ziRef);
      stAmp = STREET_AMP * Math.min(1, (ws - STREET_WIND_MIN) / 2);
    }
  }
  const mStore = (iner: number): number => Math.max(0.3, Math.min(2, 1 + STORE_GAIN * S.heatStore * iner * dM));
  const wRef = wStar((dni * su[2] + diff) * (1 - ALBEDO) * BETA * mStore(IREF), ziAt(gRef != null ? gRef : (S.AF ? S.AF.elev : 0)));   // flat reference ground
  const scaleRef = Math.max(0.15, wRef);

  const lcp = lcParams(g, cLat, cLon, R);
  const bucket = Math.floor((S.G0 + S.cur) / 900);   // recompute every ~15 min of sim time
  const wxe = wxEpoch();                              // sandbox atmosphere version (incl. its date/hour)
  if (!cache || cache.terr !== g || cache.k !== k || cache.bucket !== bucket || cache.wxr !== !!wx || cache.lcv !== lcp.lcv || cache.cal !== cal || cache.wxe !== wxe || cache.hs !== S.heatStore) {
    const bins = COLORS.map(() => ({ pos: [] as number[], nrm: [] as number[], idx: [] as number[] }));
    const nlon = (i: number) => g.cLon + (-g.R + i * g.sp) / g.mLng, nlat = (j: number) => g.cLat + (-g.R + j * g.sp) / g.mLat;
    // Per node: sun incidence on the slope × heat flux (albedo + sensible fraction
    // from land-cover, else uniform) → w*, then the fractional anomaly vs the flat
    // reference. Positive = better-heated than flat (rises), negative = worse (sinks).
    const alb = lcp.alb, sens = lcp.sens, iners = lcp.iner, vzN = new Float32Array(GN * GN);
    // Topographic cast shadows: scan the DEM toward the sun; if upwind terrain rises
    // above the sun line, the direct beam is blocked and only diffuse light remains.
    // Grid-space horizon march (nearest-node, geometric steps) — cheap, and it fixes
    // low-sun scenes where a sun-facing valley is actually shaded by a peak upwind.
    const sH = Math.hypot(su[0], su[1]);
    const shadows = sH > 0.05;                     // sun low enough for shadows to matter
    const tanSun = su[2] / (sH || 1);              // sun elevation as a slope (rise / run)
    const dIx = shadows ? su[0] / (sH * g.sp) : 0, dJy = shadows ? su[1] / (sH * g.sp) : 0;   // cells per metre toward the sun
    const sDists: number[] = [];
    if (shadows) for (let d = g.sp * 0.7; d < g.R * 0.7; d *= 1.45) sDists.push(d);
    for (let idx = 0; idx < GN * GN; idx++) {
      const n = g.nodes[idx];
      if (Number.isNaN(n.h)) { vzN[idx] = NaN; continue; }
      const i0 = idx % GN, j0 = (idx / GN) | 0;
      const zi = ziAt(n.h);
      if (zi < 100) { vzN[idx] = NaN; continue; }   // above the boundary layer → no thermal here
      const nl = Math.hypot(n.gx, n.gy, 1);
      const cosInc = Math.max(0, (su[0] * -n.gx + su[1] * -n.gy + su[2]) / nl);
      let shade = 1;                               // 1 = full sun, 0 = shadowed by upwind relief
      if (shadows && cosInc > 0) {
        let horizon = 0;                           // steepest terrain angle toward the sun so far
        for (const d of sDists) {
          const si = Math.round(i0 + dIx * d), sj = Math.round(j0 + dJy * d);
          if (si < 0 || si >= GN || sj < 0 || sj >= GN) break;
          const z = g.nodes[sj * GN + si].h;
          if (Number.isNaN(z)) continue;
          const ang = (z - n.h) / d; if (ang > horizon) horizon = ang;
        }
        shade = Math.max(0, Math.min(1, (tanSun - horizon) / 0.06));   // soft edge over ~3.5°
      }
      // Convex-break trigger bias: thermals detach at ridges / convex slope breaks, not on
      // the merely sun-warmed surface. Weight by TPI (height above the 4-neighbour mean):
      // convex ground (TPI>0) is favoured, concave (valley floors, TPI<0) damped. Cheap —
      // reuses the grid elevations. (The downwind drift of the released bubble is not modelled.)
      let sN = 0, cN = 0;
      if (i0 > 0)      { const z = g.nodes[idx - 1].h;  if (!Number.isNaN(z)) { sN += z; cN++; } }
      if (i0 < GN - 1) { const z = g.nodes[idx + 1].h;  if (!Number.isNaN(z)) { sN += z; cN++; } }
      if (j0 > 0)      { const z = g.nodes[idx - GN].h; if (!Number.isNaN(z)) { sN += z; cN++; } }
      if (j0 < GN - 1) { const z = g.nodes[idx + GN].h; if (!Number.isNaN(z)) { sN += z; cN++; } }
      const trig = 1 + TRIG_GAIN * Math.max(-1, Math.min(1, (cN ? n.h - sN / cN : 0) / TPI_REF));
      // Snow cover above the seasonal snow line: blend to snow albedo → very little heating.
      const albC = alb ? alb[idx] : ALBEDO, sf = Math.max(0, Math.min(1, (n.h - snowLine) / SNOW_BAND));
      const albE = albC + (SNOW_ALB - albC) * sf;
      // Cloud-street organisation: across-wind cosine banding of the heat flux.
      const st = stAmp > 0 ? 1 + stAmp * Math.cos(stK * ((-g.R + i0 * g.sp) * stPE + (-g.R + j0 * g.sp) * stPN)) : 1;
      const H = (dni * cosInc * shade + diff) * (1 - albE) * (sens ? sens[idx] : BETA) * mStore(iners ? iners[idx] : IREF) * st;
      vzN[idx] = wStar(H, zi) * trig;                                  // absolute updraught Vz (m/s), biased to convex triggers
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
    // Warm from absolute Vz, blue from the deficit below the flat reference — both
    // view-independent (fixed thresholds), so colours are stable as the camera moves.
    for (let j = 0; j < NW; j++) for (let i = 0; i < NW; i++) {
      const w = Ws[j * NW + i]; if (Number.isNaN(w)) continue;
      let bin: number;
      if (w >= wRef) { const f = w / W_FULL; if (f < WARM_MIN) continue; bin = 0; while (bin < WARM_FRAC.length && f >= WARM_FRAC[bin]) bin++; }   // strength → warm (0-4)
      else { const s = (wRef - w) / scaleRef; if (s < SINK_MIN) continue; bin = VZ_COLORS.length; while (bin - VZ_COLORS.length < SINK_FRAC.length && s >= SINK_FRAC[bin - VZ_COLORS.length]) bin++; }   // below flat → sink (5-7)
      const a = g.nodes[j * GN + i], b = g.nodes[j * GN + i + 1], cc = g.nodes[(j + 1) * GN + i], d = g.nodes[(j + 1) * GN + i + 1];
      const B = bins[bin], st = B.pos.length / 3;
      const P = (ii: number, jj: number, h: number) => { B.pos.push(nlon(ii), nlat(jj), h * k + OFF); B.nrm.push(0, 0, 1); };
      P(i, j, a.h); P(i + 1, j, b.h); P(i + 1, j + 1, d.h); P(i, j + 1, cc.h);
      B.idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
    }
    const meshes = bins.map((B, i) => B.idx.length ? {
      color: COLORS[i],
      mesh: {
        attributes: { POSITION: { value: new Float32Array(B.pos), size: 3 }, NORMAL: { value: new Float32Array(B.nrm), size: 3 } },
        indices: { value: new Uint32Array(B.idx), size: 1 }, mode: 4,
      },
    } : null).filter(Boolean) as { color: number[]; mesh: any }[];
    // Predicted cumulus on a cu day: mark the strongest thermal cores with a cloud at
    // the cloudbase, thinned so they don't clutter (skip cells where terrain pokes
    // through the base). A blue day (ceiling < cloudbase) gets none.
    const cu: Puff[] = [];
    if (isCu) {
      const cb = cloudbase as number, THIN = 6, MAX_CU = 60, occ = new Set<string>();
      for (let j = 0; j < NW && cu.length < MAX_CU; j++) for (let i = 0; i < NW; i++) {
        const w = Ws[j * NW + i]; if (Number.isNaN(w) || w < 0.72 * W_FULL) continue;
        const bk = `${(i / THIN) | 0},${(j / THIN) | 0}`; if (occ.has(bk)) continue;
        const gh = g.nodes[j * GN + i].h; if (Number.isNaN(gh) || cb < gh + 60) continue;   // base below the ground here
        occ.add(bk);
        cu.push({ pos: [nlon(i), nlat(j), cb * k], size: 260 + Math.min(1, w / W_FULL) * 420 });
      }
    }
    cache = { terr: g, k, bucket, wxr: !!wx, lcv: lcp.lcv, cal, wxe, hs: S.heatStore, meshes, cu };
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
