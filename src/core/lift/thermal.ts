// ============ thermal potential: an estimated updraught (Vz) field from physics ========
// Where does the ground heat the air enough to make thermals? Take the incoming sun on each
// terrain facet (sun geometry × slope aspect from the DEM, minus any cast shadow from relief
// toward the sun), turn it into a sensible heat flux (absorbed = flux·(1−albedo), a sensible
// fraction of that), then the convective velocity scale
//   w* = [ (g/θ)·(H/ρcp)·z_i ]^(1/3)
// with the boundary-layer depth z_i from the weather. A coarse, illustrative diagnostic (no
// advection, no cloud shading) — see the docs. But a value: no renderer, no app state, and
// the land cover arrives as DATA, never fetched here.
import { sampleNodes, type NodeGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import { sunLightDir } from '../sky';
import type { ElevSampler } from '../ports';

export const GRAD = 80;         // slope-gradient baseline (m) — short, for the true local slope
export const ALBEDO = 0.2;      // uniform surface albedo, when no land cover says otherwise
export const SNOW_ALB = 0.72;   // albedo of snow cover — reflects most of the sun, so it barely heats
export const SNOW_MID = 2100, SNOW_AMP = 1100, SNOW_BAND = 300;   // m: seasonal snow line (mid ± amplitude) and its blend width
export const BETA = 0.35;       // sensible-heat fraction of the absorbed flux (Bowen + ground)
export const TRIG_GAIN = 0.4;   // convex-break trigger: ± bias on the heated field from topographic position
export const TPI_REF = 18;      // m: TPI (height above the local mean) that saturates the trigger bias
export const STORE_GAIN = 1.4;  // strength of the diurnal heat storage/restitution modulation
export const TAU_H = 2.6;       // h: ground heat-storage time constant (the lag before stored heat is released)
export const IREF = 0.4;        // reference-ground inertia (the flat reference gets the same diurnal modulation)
export const SUN_MIN = 0.02;    // sin(sun elevation) below which there are no thermals at all
const G = 9.81, THETA = 290, RHOCP = 1200;   // gravity, ref pot. temp (K), ρ·cp (J/m³K)

/** Seasonal snow line (m): high in summer, low in winter; flipped in the southern hemisphere.
 *  Above it the ground turns white and stops heating — thermals die on the high peaks. */
export function snowLineM(ms: number, lat: number): number {
  const d = new Date(ms);
  let doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  if (lat < 0) doy = (doy + 182.5) % 365;
  return SNOW_MID + SNOW_AMP * Math.cos(2 * Math.PI * (doy - 200) / 365);   // peaks ~late July (NH)
}

/** Diurnal ground heat storage: a first-order reservoir lagging the day's solar forcing, so
 *  heat absorbed around midday is released in the late afternoon. Returns ΔM at the instant
 *  = (reservoir − instantaneous forcing) / peak forcing — negative in the morning (ground
 *  charging: thermals damped, late), positive in the late afternoon (ground releasing:
 *  thermals boosted, prolonged). Cheap: 24 sun-elevation samples. 0 in the polar night. */
export function diurnalStore(ms: number, lat: number, lon: number): number {
  const DAY = 86400000, dayStart = Math.floor(ms / DAY) * DAY;
  const F = new Float64Array(24);
  let Fmax = 0;
  for (let h = 0; h < 24; h++) {
    const f = Math.max(0, -sunLightDir(dayStart + h * 3600000, lat, lon)[2]);
    F[h] = f; if (f > Fmax) Fmax = f;
  }
  if (Fmax <= 1e-4) return 0;                                   // polar night → no cycle
  const a = 1 - Math.exp(-1 / TAU_H);
  const Sr = new Float64Array(24);
  let s = 0;
  for (let pass = 0; pass < 3; pass++) for (let h = 0; h < 24; h++) { s += a * (F[h] - s); Sr[h] = s; }   // spin up to a periodic day
  const hf = ((ms - dayStart) / 3600000) % 24, h0 = Math.floor(hf), h1 = (h0 + 1) % 24, fr = hf - h0;
  const Ff = F[h0] + (F[h1] - F[h0]) * fr, Sf = Sr[h0] + (Sr[h1] - Sr[h0]) * fr;
  return (Sf - Ff) / Fmax;
}

/** Per-node surface properties from a land-cover raster (indexed j * n + i). Null members
 *  fall back to the uniform defaults. The kernel never fetches this. */
export interface LandCover { alb: Float32Array | null; sens: Float32Array | null; iner: Float32Array | null }

/** Cloud streets: with enough boundary-layer wind and depth, thermals organise into rolls
 *  aligned with the wind. A cosine banding of the heat flux ACROSS the wind — a
 *  redistribution (mean ≈ 1), not extra energy. */
export interface Streets { k: number; amp: number; pE: number; pN: number }

export interface ThermalParams {
  sun: [number, number, number];   // unit vector towards the sun (ENU)
  dni: number;                     // direct normal irradiance (W/m²)
  diff: number;                    // diffuse irradiance (W/m²)
  convTop: number;                 // AMSL thermal ceiling; NaN ⇒ use ziFallback
  ziFallback: number;              // boundary-layer depth when there is no sounding (m)
  refElev: number;                 // the flat reference ground (m AMSL)
  cal: number;                     // day-scale calibration from the observed climbs
  heatStore: number;               // 0..1 user knob on the diurnal storage
  dM: number;                      // the storage anomaly now — see diurnalStore()
  snowLine: number;                // m AMSL
  lc: LandCover | null;
  street: Streets | null;
  grad?: number; albedo?: number; beta?: number; trigGain?: number;
}

/** The thermal field. `vz` is per CELL (an (n−1)² grid of quads, 3×3-blurred), NaN where the
 *  ground is unknown or above the boundary layer; the node terrain comes along because the
 *  quads are draped on it. `wRef` is the updraught a FLAT patch of reference ground gets under
 *  this sun — the view-independent yardstick every cell is read against. */
export interface ThermalField {
  grid: NodeGrid; nw: number;
  lon: Float64Array; lat: Float64Array;
  h: Float32Array; ok: Uint8Array;
  vz: Float32Array;
  wRef: number; scaleRef: number;
  ready: number; total: number;
}

export function thermalField(g: NodeGrid, elev: ElevSampler, p: ThermalParams): ThermalField {
  const grad = p.grad ?? GRAD, albedo = p.albedo ?? ALBEDO, beta = p.beta ?? BETA;
  const trigGain = p.trigGain ?? TRIG_GAIN;
  const su = p.sun, n = g.n, total = n * n, nw = n - 1;
  const t = sampleNodes(g, elev, grad);
  const { lon, lat, h, gx, gy, ok, sp } = t;

  const ziAt = (elevM: number): number =>
    Math.max(0, Math.min(3500, Number.isFinite(p.convTop) ? p.convTop - elevM : p.ziFallback));
  const wStar = (H: number, zi: number): number => p.cal * 0.6 * Math.cbrt((G / THETA) * (H / RHOCP) * zi);
  const mStore = (iner: number): number => Math.max(0.3, Math.min(2, 1 + STORE_GAIN * p.heatStore * iner * p.dM));

  // The view-independent yardstick: what flat reference ground makes under this sun.
  const wRef = wStar((p.dni * su[2] + p.diff) * (1 - albedo) * beta * mStore(IREF), ziAt(p.refElev));
  const scaleRef = Math.max(0.15, wRef);

  // Cast shadows: march the DEM toward the sun; if relief rises above the sun line, the direct
  // beam is blocked and only diffuse light remains. This is what fixes low-sun scenes where a
  // sun-facing valley is in fact shaded by a peak.
  const sH = Math.hypot(su[0], su[1]);
  const shadows = sH > 0.05;                     // sun low enough for shadows to matter
  const tanSun = su[2] / (sH || 1);              // sun elevation as a slope (rise / run)
  const dIx = shadows ? su[0] / (sH * sp) : 0, dJy = shadows ? su[1] / (sH * sp) : 0;   // cells per metre toward the sun
  const sDists: number[] = [];
  if (shadows) for (let d = sp * 0.7; d < g.R * 0.7; d *= 1.45) sDists.push(d);

  // Node positions in metres from a fixed earth origin (lon 0, lat 0) — what the cloud
  // streets take their phase from, so a street stays put on the ground while the view moves.
  const mLng = mPerLng(g.cLat);
  const xAbs = Array.from(lon, (l) => l * mLng), yAbs = Array.from(lat, (l) => l * M_PER_LAT);

  const alb = p.lc?.alb ?? null, sens = p.lc?.sens ?? null, iners = p.lc?.iner ?? null;
  const vzN = new Float32Array(total).fill(NaN);
  for (let idx = 0; idx < total; idx++) {
    if (!ok[idx]) continue;
    const i0 = idx % n, j0 = (idx / n) | 0, hC = h[idx];
    const zi = ziAt(hC);
    if (zi < 100) continue;                      // above the boundary layer → no thermal here
    const nl = Math.hypot(gx[idx], gy[idx], 1);
    const cosInc = Math.max(0, (su[0] * -gx[idx] + su[1] * -gy[idx] + su[2]) / nl);
    let shade = 1;                               // 1 = full sun, 0 = shadowed by relief
    if (shadows && cosInc > 0) {
      let horizon = 0;                           // steepest terrain angle toward the sun so far
      for (const d of sDists) {
        const si = Math.round(i0 + dIx * d), sj = Math.round(j0 + dJy * d);
        if (si < 0 || si >= n || sj < 0 || sj >= n) break;
        const si2 = sj * n + si; if (!ok[si2]) continue;
        const ang = (h[si2] - hC) / d; if (ang > horizon) horizon = ang;
      }
      shade = Math.max(0, Math.min(1, (tanSun - horizon) / 0.06));   // soft edge over ~3.5°
    }
    // Convex-break trigger bias: thermals detach at ridges and convex slope breaks, not on the
    // merely sun-warmed surface. Weight by TPI (height above the 4-neighbour mean): convex
    // ground is favoured, concave (valley floors) damped.
    let sN = 0, cN = 0;
    if (i0 > 0)     { const q = idx - 1; if (ok[q]) { sN += h[q]; cN++; } }
    if (i0 < n - 1) { const q = idx + 1; if (ok[q]) { sN += h[q]; cN++; } }
    if (j0 > 0)     { const q = idx - n; if (ok[q]) { sN += h[q]; cN++; } }
    if (j0 < n - 1) { const q = idx + n; if (ok[q]) { sN += h[q]; cN++; } }
    const trig = 1 + trigGain * Math.max(-1, Math.min(1, (cN ? hC - sN / cN : 0) / TPI_REF));
    // Snow above the seasonal snow line: blend to snow albedo → very little heating.
    const albC = alb ? alb[idx] : albedo, sf = Math.max(0, Math.min(1, (hC - p.snowLine) / SNOW_BAND));
    const albE = albC + (SNOW_ALB - albC) * sf;
    // Cloud-street organisation: across-wind cosine banding of the heat flux. The phase is
    // measured from a fixed point on the EARTH, not from the centre of the grid — the grid
    // centre is the camera, and streets anchored to the camera slide across the terrain as
    // you pan.
    const st = p.street
      ? 1 + p.street.amp * Math.cos(p.street.k * (xAbs[i0] * p.street.pE + yAbs[j0] * p.street.pN))
      : 1;
    const H = (p.dni * cosInc * shade + p.diff) * (1 - albE) * (sens ? sens[idx] : beta)
      * mStore(iners ? iners[idx] : IREF) * st;
    vzN[idx] = wStar(H, zi) * trig;              // absolute updraught Vz (m/s), biased to convex triggers
  }

  // Node values → cell values (mean of the 4 corners), then a light 3×3 blur: the bins would
  // otherwise checkerboard.
  const cell = new Float32Array(nw * nw).fill(NaN);
  for (let j = 0; j < nw; j++) for (let i = 0; i < nw; i++) {
    const a = vzN[j * n + i], b = vzN[j * n + i + 1], c = vzN[(j + 1) * n + i], d = vzN[(j + 1) * n + i + 1];
    if (!Number.isNaN(a) && !Number.isNaN(b) && !Number.isNaN(c) && !Number.isNaN(d)) cell[j * nw + i] = (a + b + c + d) / 4;
  }
  const vz = new Float32Array(nw * nw).fill(NaN);
  for (let j = 0; j < nw; j++) for (let i = 0; i < nw; i++) {
    let s = 0, m = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const jj = j + dj, ii = i + di; if (jj < 0 || jj >= nw || ii < 0 || ii >= nw) continue;
      const v = cell[jj * nw + ii]; if (!Number.isNaN(v)) { s += v; m++; }
    }
    if (m) vz[j * nw + i] = s / m;
  }
  return { grid: g, nw, lon, lat, h, ok, vz, wRef, scaleRef, ready: t.ready, total };
}

/** A predicted cumulus: a cloud at the base over a strong thermal core, drifted downwind by
 *  the wind the parcel meets while it climbs there. Positions and sizes only. */
export interface CumulusSpot { lon: number; lat: number; base: number; size: number }

export interface CumulusParams {
  cloudbase: number;                       // m AMSL
  drift: readonly [number, number] | null; // layer wind (m/s) carrying the climbing parcel
  wFull: number;                           // the Vz that counts as a strong core
  climb?: number; driftCap?: number; thin?: number; max?: number;
}

export const DRIFT_CLIMB = 2.5;   // m/s: nominal in-thermal climb, for the parcel's time to reach cloudbase
export const DRIFT_CAP = 6000;    // m: cap the downwind drift so clouds stay in the domain
export const CU_THIN = 6, CU_MAX = 60;
export const CU_STRONG = 0.72;    // fraction of wFull above which a core is marked with a cloud

export function cumulusSpots(f: ThermalField, p: CumulusParams): CumulusSpot[] {
  const climb = p.climb ?? DRIFT_CLIMB, cap = p.driftCap ?? DRIFT_CAP;
  const thin = p.thin ?? CU_THIN, max = p.max ?? CU_MAX;
  const { nw, grid } = f, n = grid.n;
  const out: CumulusSpot[] = [], occ = new Set<string>();
  for (let j = 0; j < nw; j++) for (let i = 0; i < nw; i++) {
    if (out.length >= max) return out;
    const w = f.vz[j * nw + i];
    if (Number.isNaN(w) || w < CU_STRONG * p.wFull) continue;
    const bk = `${(i / thin) | 0},${(j / thin) | 0}`; if (occ.has(bk)) continue;
    const idx = j * n + i;
    if (!f.ok[idx] || p.cloudbase < f.h[idx] + 60) continue;   // the base is below the ground here
    occ.add(bk);
    // The parcel is carried by the wind while it climbs from the trigger to cloudbase
    // (t ≈ Δz / climb), so the cloud sits downwind of the hot slope that made it.
    let dlon = 0, dlat = 0;
    if (p.drift) {
      const dz = p.cloudbase - f.h[idx];
      let dE = p.drift[0] * dz / climb, dN = p.drift[1] * dz / climb;
      const dm = Math.hypot(dE, dN);
      if (dm > cap) { dE *= cap / dm; dN *= cap / dm; }
      dlon = dE / mPerLng(grid.cLat); dlat = dN / M_PER_LAT;
    }
    out.push({
      lon: f.lon[i] + dlon, lat: f.lat[j] + dlat, base: p.cloudbase,
      size: 260 + Math.min(1, w / p.wFull) * 420,
    });
  }
  return out;
}
