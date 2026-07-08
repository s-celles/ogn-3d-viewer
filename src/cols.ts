// ============ workable mountain passes (cols) ============
// A col (saddle) is a low point on a ridge between two summits: terrain curving DOWN across
// the ridge (the two valleys) and UP along it (the two peaks). We find them from the DEM by
// the Hessian test — a saddle has negative Gaussian curvature (det(H) < 0) — then keep the
// ones the wind blows THROUGH (venturi + slope lift on the upwind approach), i.e. workable.
// Each is marked with a ridge tick + an arrow along the through-wind, green when strong.
// Terrain × wind, predicted from the DEM — rough and illustrative (see the docs).
import { S } from './state';
import { PathLayer } from './deck';
import { terrainElevAt } from './terrain';
import { windBg } from './ridge';
import { wxEpoch } from './weather';

const NG = 56;           // grid nodes per side
const COL_OFF = 45;      // m: lift the marker off the col
const COL_WMIN = 3;      // m/s: min wind blowing THROUGH the col to count as workable
const CURV_MIN = 4e-5;   // 1/m: min terrain curvature on both axes (rejects flats / noise)
const RM = 420;          // m: ridge-tick half-length
const MAXC = 26;         // cap on markers

interface Col { lon: number; lat: number; h: number; ex: number; ey: number; through: number }   // ex,ey = through-axis unit; through = signed wind-through (m/s)
let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; cols: Col[] } | null = null;

function build(cols: Col[], k: number): any[] {
  if (!cols.length) return [];
  const segs: { path: number[][]; c: [number, number, number] }[] = [];
  for (const c of cols) {
    const z = (c.h + COL_OFF) * k, mLng = 111320 * Math.cos(c.lat * Math.PI / 180), mLat = 111320;
    const P = (ox: number, oy: number): number[] => [c.lon + ox / mLng, c.lat + oy / mLat, z];
    const col: [number, number, number] = Math.abs(c.through) >= 6 ? [80, 210, 120] : [228, 190, 92];   // strong / mild through-wind
    const rx = -c.ey, ry = c.ex;                                 // ridge unit (⟂ to the through-axis)
    segs.push({ path: [P(rx * RM, ry * RM), P(-rx * RM, -ry * RM)], c: [210, 215, 225] });   // the ridge line (grey)
    const s = Math.sign(c.through) || 1, ax = c.ex * s, ay = c.ey * s;   // downwind through direction
    const AL = Math.max(320, Math.min(1150, 320 + Math.abs(c.through) * 95)), tx = ax * AL, ty = ay * AL;
    segs.push({ path: [P(0, 0), P(tx, ty)], c: col });           // through-wind arrow
    const bx = -ax, by = -ay, hx = -ay, hy = ax;                 // back + perpendicular, for the arrowhead
    segs.push({ path: [P(tx, ty), P(tx + bx * 190 + hx * 115, ty + by * 190 + hy * 115)], c: col });
    segs.push({ path: [P(tx, ty), P(tx + bx * 190 - hx * 115, ty + by * 190 - hy * 115)], c: col });
  }
  return [new PathLayer({
    id: 'cols', data: segs, getPath: (d: any) => d.path, getColor: (d: any) => [d.c[0], d.c[1], d.c[2], 235],
    getWidth: 2.5, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: { depthTest: true } as any,
  } as any)];
}

/** Markers at the wind-workable cols (saddles the wind blows through) around the view. */
export function colLayers(k: number): any[] {
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const wind = windBg(cLat, cLon); if (!wind) return [];
  if (Math.hypot(wind[0], wind[1]) < 1) return [];   // calm → nothing blows through
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;
  const R = Math.max(4000, Math.min(24000, mppx * 750));
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * 111320 * cosLat, (cache.cLat - cLat) * 111320);
    if (moved < R * 0.33) return build(cache.cols, k);
  }
  const mLng = 111320 * Math.cos(cLat * Math.PI / 180), mLat = 111320, sp = (2 * R) / (NG - 1);
  const nlon = (i: number) => cLon + (-R + i * sp) / mLng, nlat = (j: number) => cLat + (-R + j * sp) / mLat;
  const H = new Float32Array(NG * NG), ok = new Uint8Array(NG * NG);
  let ready = 0;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const h = terrainElevAt(nlon(i), nlat(j)); if (h == null) continue;
    H[j * NG + i] = h; ok[j * NG + i] = 1; ready++;
  }
  if (ready < NG * NG * 0.4) return [];   // terrain not loaded here yet
  const found: Col[] = [], d2 = sp * sp;
  for (let j = 1; j < NG - 1; j++) for (let i = 1; i < NG - 1; i++) {
    const idx = j * NG + i;
    if (!ok[idx] || !ok[idx + 1] || !ok[idx - 1] || !ok[idx + NG] || !ok[idx - NG] || !ok[idx + NG + 1] || !ok[idx + NG - 1] || !ok[idx - NG + 1] || !ok[idx - NG - 1]) continue;
    const C = H[idx];
    const hxx = (H[idx + 1] - 2 * C + H[idx - 1]) / d2, hyy = (H[idx + NG] - 2 * C + H[idx - NG]) / d2;
    const hxy = (H[idx + NG + 1] - H[idx + NG - 1] - H[idx - NG + 1] + H[idx - NG - 1]) / (4 * d2);
    const det = hxx * hyy - hxy * hxy; if (det >= 0) continue;   // saddle only (negative Gaussian curvature)
    const trc = hxx + hyy, disc = Math.sqrt(Math.max(0, trc * trc - 4 * det)), lmin = (trc - disc) / 2, lmax = (trc + disc) / 2;
    if (lmax < CURV_MIN || -lmin < CURV_MIN) continue;           // both curvatures real (a genuine col, not a flat)
    let ex = hxy, ey = lmin - hxx; if (Math.hypot(ex, ey) < 1e-9) { ex = lmin - hyy; ey = hxy; }
    const en = Math.hypot(ex, ey) || 1; ex /= en; ey /= en;      // through-axis unit (valley direction)
    const through = wind[0] * ex + wind[1] * ey;                 // signed wind-through (m/s)
    if (Math.abs(through) < COL_WMIN) continue;                  // wind doesn't funnel through → not workable
    found.push({ lon: nlon(i), lat: nlat(j), h: C, ex, ey, through });
  }
  // Keep the best (strongest through-wind), thinned so neighbours don't clump.
  found.sort((a, b) => Math.abs(b.through) - Math.abs(a.through));
  const cols: Col[] = [];
  for (const c of found) {
    if (cols.length >= MAXC) break;
    if (cols.every(q => (q.lon - c.lon) * (q.lon - c.lon) * mLng * mLng + (q.lat - c.lat) * (q.lat - c.lat) * mLat * mLat >= 5 * d2)) cols.push(c);
  }
  cache = { cLon, cLat, R, hour, wk, cols };
  return build(cols, k);
}
