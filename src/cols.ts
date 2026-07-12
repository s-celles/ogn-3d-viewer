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
import { windBg } from './wind-source';
import { wxEpoch } from './weather';
import { M_PER_LAT, mPerLng, metresPerPixel } from './core/geo';

const NG = 56;           // grid nodes per side
const COL_OFF = 45;      // m: lift the marker off the col
const COL_WMIN = 3;      // m/s: min wind blowing THROUGH the col to count as workable
const CURV_MIN = 4e-5;   // 1/m: min terrain curvature on both axes (rejects flats / noise)
const RM = 420;          // m: ridge-tick half-length
const ARM = 640;         // m: half-length of the through-flow glyph (each side of the col)
const DROP = 300;        // m: how far the windward/lee ends sit below the col crest
const MAXC = 26;         // cap on markers

interface Col { lon: number; lat: number; h: number; ex: number; ey: number; through: number }   // ex,ey = through-axis unit; through = signed wind-through (m/s)
let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; cols: Col[] } | null = null;

function build(cols: Col[], k: number): any[] {
  if (!cols.length) return [];
  const segs: { path: number[][]; c: [number, number, number] }[] = [];
  const LIFT: [number, number, number] = [80, 210, 120], MILD: [number, number, number] = [228, 190, 92], SINK: [number, number, number] = [90, 150, 235];
  for (const c of cols) {
    const zc = (c.h + COL_OFF) * k, zlow = (c.h + COL_OFF - DROP) * k, mLng = mPerLng(c.lat), mLat = M_PER_LAT;
    const P = (ox: number, oy: number, z: number): number[] => [c.lon + ox / mLng, c.lat + oy / mLat, z];
    const rx = -c.ey, ry = c.ex;                                 // ridge unit (⟂ to the through-axis)
    segs.push({ path: [P(rx * RM, ry * RM, zc), P(-rx * RM, -ry * RM, zc)], c: [210, 215, 225] });   // the ridge line (grey)
    const s = Math.sign(c.through) || 1, ax = c.ex * s, ay = c.ey * s;   // downwind (through) direction
    const lift = Math.abs(c.through) >= 6 ? LIFT : MILD;
    // Flow OVER the col: rises up the windward slope (lift, green) to the crest, then sinks
    // down the lee (blue). The exploitable side is the windward one — the tail, not the head.
    const col0 = P(0, 0, zc), windPt = P(-ax * ARM, -ay * ARM, zlow), leePt = P(ax * ARM, ay * ARM, zlow);
    segs.push({ path: [windPt, col0], c: lift });                // windward climb (exploitable)
    segs.push({ path: [col0, leePt], c: SINK });                 // lee descent (sink / rotor)
    const hx = -ay, hy = ax;                                     // ridge-perpendicular, for the arrowhead on the lee end
    segs.push({ path: [leePt, P(ax * ARM - ax * 200 + hx * 120, ay * ARM - ay * 200 + hy * 120, zlow)], c: SINK });
    segs.push({ path: [leePt, P(ax * ARM - ax * 200 - hx * 120, ay * ARM - ay * 200 - hy * 120, zlow)], c: SINK });
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
  const mppx = metresPerPixel(cLat, zoom);
  const R = Math.max(4000, Math.min(24000, mppx * 750));
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.25) {
    const cosLat = Math.cos(cLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - cLon) * M_PER_LAT * cosLat, (cache.cLat - cLat) * M_PER_LAT);
    if (moved < R * 0.33) return build(cache.cols, k);
  }
  const mLng = mPerLng(cLat), mLat = M_PER_LAT, sp = (2 * R) / (NG - 1);
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
