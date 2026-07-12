// ============ wind flow: animated streaks draped on the terrain ============
// Windy/earth-style particle flow, driven by the same local + terrain-refined wind
// as the slope-lift layer. A coarse wind grid is precomputed over the view (one
// background wind, refined per node by the terrain — upwind sheltering + deflection
// away from steep rising ground); particles are advected through it and drawn as
// short streaks whose length grows with speed. Rough and illustrative (see docs).
import { S } from './state';
import { t } from './i18n';
import { LineLayer, SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { terrainElevAt } from './terrain';
import { windBg, windAtAlt } from './wind-source';
import { windArrow, windSpd, windDir } from './dom';
import type { Pos3 } from './types';
import { M_PER_LAT, mPerLng, metresPerPixel } from './core/geo';

const GN = 56;           // wind-grid nodes per side (finer → smoother contours)
const N = 1100;          // particle count
const DTS = 0.5;         // advection: metres = wind(m/s) x DTS per frame
const MAXAGE = 90;       // particle lifetime (frames)
const STREAK_K = 9;      // streak length: metres per m/s
const STREAK_MAX = 450;  // ... capped (m)
const OFF = 25;          // drape offset above the surface (m)
const LU = 900;          // upwind sheltering probe (m)
const H_SHELTER = 320;   // upwind terrain this much higher → fully sheltered (m)
// 3D "layers" mode: arrows at these altitudes (m above the local surface), low→high colours.
const BAND_ALTS = [200, 1000, 2200, 3600];
const BAND_COLORS: [number, number, number][] = [[120, 205, 255], [130, 235, 160], [240, 220, 110], [240, 120, 90]];

// Speed backdrop: green (calm) → red (strong), draped just under the streaks.
const SPEED_BINS = [2, 4, 6, 9, 13];   // m/s thresholds → 6 colour bins
const SPEED_COLORS: [number, number, number][] = [[70, 175, 95], [140, 200, 70], [215, 210, 60], [232, 160, 50], [224, 105, 55], [208, 66, 62]];
const BACK_A = 62, BACK_OFF = 6;       // backdrop alpha / drape offset (m)
const backParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Node { u: number; v: number; h: number }
interface Grid { cLon: number; cLat: number; R: number; mLng: number; mLat: number; sp: number; hour: number; wk: string; nodes: Node[] }
interface Particle { lon: number; lat: number; age: number; band: number }   // band -1 = drape (surface)
interface Field { cLon: number; cLat: number; R: number; mLng: number; mLat: number; hour: number }

type WMode = 'off' | 'drapeVec' | 'drapeCol' | 'drapeBoth' | 'barbs' | 'isotachs' | 'layers' | 'rings' | 'hodograph';
let mode: WMode = 'off';
let grid: Grid | null = null;                                  // drape mode
let bands: { alt: number; u: number; v: number }[] = [];       // layers mode
let field: Field | null = null;                                // layers mode
let parts: Particle[] = [];

const rnd = () => Math.random();

// Build the refined wind grid over the view, or null if no wind / terrain not ready.
function buildGrid(cLat: number, cLon: number, R: number): Grid | null {
  const bg = windBg(cLat, cLon); if (!bg) return null;
  const s0 = Math.hypot(bg[0], bg[1]); if (s0 < 1.5) return null;
  const mLng = mPerLng(cLat), mLat = M_PER_LAT, sp = (2 * R) / (GN - 1);
  const upE = -bg[0] / s0, upN = -bg[1] / s0;
  const nodes: Node[] = new Array(GN * GN);
  let ready = 0;
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const lon = cLon + (-R + i * sp) / mLng, lat = cLat + (-R + j * sp) / mLat;
    const h = terrainElevAt(lon, lat);
    if (h == null) { nodes[j * GN + i] = { u: bg[0], v: bg[1], h: NaN }; continue; }
    ready++;
    const hE = terrainElevAt(lon + sp / mLng, lat), hW = terrainElevAt(lon - sp / mLng, lat);
    const hN = terrainElevAt(lon, lat + sp / mLat), hS = terrainElevAt(lon, lat - sp / mLat);
    const hUp = terrainElevAt(lon + upE * LU / mLng, lat + upN * LU / mLat);
    const scale = hUp == null ? 1 : Math.max(0.2, Math.min(1.4, 1 - (hUp - h) / H_SHELTER));   // lee shelter / crest boost
    let u = bg[0] * scale, v = bg[1] * scale;
    if (hE != null && hW != null && hN != null && hS != null) {
      const gx = (hE - hW) / (2 * sp), gy = (hN - hS) / (2 * sp), gm = Math.hypot(gx, gy);   // terrain gradient
      if (gm > 1e-4) {                                                                        // deflect flow away from climbing steep ground
        const gxu = gx / gm, gyu = gy / gm, into = u * gxu + v * gyu, beta = Math.min(0.85, gm * 7);
        if (into > 0) { u -= beta * into * gxu; v -= beta * into * gyu; }
      }
    }
    nodes[j * GN + i] = { u, v, h };
  }
  if (ready < GN * GN * 0.4) return null;   // terrain under the grid not loaded yet
  return { cLon, cLat, R, mLng, mLat, sp, hour: 0, wk: '', nodes };
}

// Bilinear sample of the grid at a lon/lat (clamped to the grid).
function sample(g: Grid, lon: number, lat: number): Node {
  const fx = Math.max(0, Math.min(GN - 1.001, ((lon - g.cLon) * g.mLng + g.R) / g.sp));
  const fy = Math.max(0, Math.min(GN - 1.001, ((lat - g.cLat) * g.mLat + g.R) / g.sp));
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
  const a = g.nodes[j * GN + i], b = g.nodes[j * GN + i + 1], c = g.nodes[(j + 1) * GN + i], d = g.nodes[(j + 1) * GN + i + 1];
  const lp = (pa: number, pb: number, pc: number, pd: number) => (pa * (1 - tx) + pb * tx) * (1 - ty) + (pc * (1 - tx) + pd * tx) * ty;
  return { u: lp(a.u, b.u, c.u, d.u), v: lp(a.v, b.v, c.v, d.v), h: lp(a.h, b.h, c.h, d.h) };
}

// Random point in the disc of radius R around a centre (uniform).
function discPos(cLon: number, cLat: number, R: number, mLng: number, mLat: number): { lon: number; lat: number } {
  const r = R * Math.sqrt(rnd()), th = rnd() * 2 * Math.PI;
  return { lon: cLon + r * Math.cos(th) / mLng, lat: cLat + r * Math.sin(th) / mLat };
}
function spawn(g: Grid): Particle { return { ...discPos(g.cLon, g.cLat, g.R, g.mLng, g.mLat), age: (rnd() * MAXAGE) | 0, band: -1 }; }
function spawnLayer(f: Field): Particle { return { ...discPos(f.cLon, f.cLat, f.R, f.mLng, f.mLat), age: (rnd() * MAXAGE) | 0, band: (rnd() * BAND_ALTS.length) | 0 }; }

// Advance every particle one frame (respawn when old / out). Drape follows the
// terrain-refined grid; layers follow their altitude band's uniform wind.
function advance(): void {
  if (mode === 'layers') {
    const f = field; if (!f || !bands.length) return;
    if (parts.length !== N || parts[0].band < 0) parts = Array.from({ length: N }, () => spawnLayer(f));
    for (const p of parts) {
      const b = bands[p.band]; if (!b) { Object.assign(p, spawnLayer(f)); continue; }
      p.lon += b.u * DTS / f.mLng; p.lat += b.v * DTS / f.mLat; p.age++;
      const dx = (p.lon - f.cLon) * f.mLng, dy = (p.lat - f.cLat) * f.mLat;
      if (p.age > MAXAGE || dx * dx + dy * dy > f.R * f.R) Object.assign(p, spawnLayer(f));
    }
    return;
  }
  if (!mode.startsWith('drape')) return;   // rings / hodograph are static — no advection
  const g = grid; if (!g) return;
  if (parts.length !== N || parts[0].band >= 0) parts = Array.from({ length: N }, () => spawn(g));
  for (const p of parts) {
    const w = sample(g, p.lon, p.lat);
    p.lon += w.u * DTS / g.mLng; p.lat += w.v * DTS / g.mLat; p.age++;
    const dx = (p.lon - g.cLon) * g.mLng, dy = (p.lat - g.cLat) * g.mLat;
    if (p.age > MAXAGE || dx * dx + dy * dy > g.R * g.R || Number.isNaN(w.h)) Object.assign(p, spawn(g));
  }
}

// One rAF ticker: advance once per frame while the layer is on (decoupled from how
// many times render() rebuilds layers). requestAnimationFrame is defined in the
// browser; the module only runs there.
function tick(): void { if (S.windMode !== 'off') advance(); requestAnimationFrame(tick); }
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);

// Speed-backdrop meshes (green calm → red strong), one per bin — computed once per
// grid (and vertical exaggeration), since the geometry only changes when they do.
let backCache: { g: Grid; k: number; meshes: { color: number[]; mesh: any }[] } | null = null;
function backdropLayers(g: Grid, k: number): any[] {
  if (!backCache || backCache.g !== g || backCache.k !== k) {
    const bins = SPEED_COLORS.map(() => ({ pos: [] as number[], nrm: [] as number[], idx: [] as number[] }));
    for (let j = 0; j < GN - 1; j++) for (let i = 0; i < GN - 1; i++) {
      const a = g.nodes[j * GN + i], b = g.nodes[j * GN + i + 1], c = g.nodes[(j + 1) * GN + i], d = g.nodes[(j + 1) * GN + i + 1];
      if (Number.isNaN(a.h) || Number.isNaN(b.h) || Number.isNaN(c.h) || Number.isNaN(d.h)) continue;
      const sp = (Math.hypot(a.u, a.v) + Math.hypot(b.u, b.v) + Math.hypot(c.u, c.v) + Math.hypot(d.u, d.v)) / 4;
      let bin = 0; while (bin < SPEED_BINS.length && sp >= SPEED_BINS[bin]) bin++;
      const B = bins[bin], st = B.pos.length / 3;
      const x0 = -g.R + i * g.sp, x1 = -g.R + (i + 1) * g.sp, y0 = -g.R + j * g.sp, y1 = -g.R + (j + 1) * g.sp;
      const P = (x: number, y: number, h: number) => { B.pos.push(g.cLon + x / g.mLng, g.cLat + y / g.mLat, h * k + BACK_OFF); B.nrm.push(0, 0, 1); };
      P(x0, y0, a.h); P(x1, y0, b.h); P(x1, y1, d.h); P(x0, y1, c.h);
      B.idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
    }
    const meshes = bins.map((B, i) => B.idx.length ? {
      color: [...SPEED_COLORS[i], BACK_A],
      mesh: {
        attributes: { POSITION: { value: new Float32Array(B.pos), size: 3 }, NORMAL: { value: new Float32Array(B.nrm), size: 3 } },
        indices: { value: new Uint32Array(B.idx), size: 1 }, mode: 4,
      },
    } : null).filter(Boolean) as { color: number[]; mesh: any }[];
    backCache = { g, k, meshes };
  }
  return backCache.meshes.map((m, i) => new SimpleMeshLayer({
    id: 'wind-back-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: m.color, material: false, parameters: backParams, mesh: m.mesh,
  } as any));
}

// Global wind rose (corner): the arrow points downwind; the text gives the speed and
// the meteorological source bearing.
function updateDial(bg: [number, number]): void {
  const toBrg = (Math.atan2(bg[0], bg[1]) * 180 / Math.PI + 360) % 360;   // direction it blows toward
  windArrow.setAttribute('transform', `rotate(${toBrg.toFixed(0)})`);
  windSpd.textContent = Math.round(Math.hypot(bg[0], bg[1]) * 3.6).toString();
  windDir.textContent = `${t('windFrom')} ${String(Math.round((toBrg + 180) % 360)).padStart(3, '0')}°`;
}

const fade = (age: number): number => { const f = age / MAXAGE; return f < 0.15 ? f / 0.15 : f > 0.75 ? (1 - f) / 0.25 : 1; };
const streakParams = { depthCompare: 'less-equal', depthWriteEnabled: false, blend: true } as any;

/** Wind-flow layer(s): 2D streaks draped on the terrain, or 3D arrows stacked at
 *  altitude bands (the wind profile). Rebuilds and reseeds as the view moves. */
export function windLayers(k: number): any[] {
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  const R = Math.max(4000, Math.min(20000, metresPerPixel(cLat, zoom) * 700));
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const bg = windBg(cLat, cLon); if (!bg) return [];
  updateDial(bg);
  if (S.windMode !== mode) { mode = S.windMode; parts = []; grid = null; field = null; }
  switch (mode) {
    case 'drapeVec': return drapeMode(cLat, cLon, R, hour, k, bg, true, false);
    case 'drapeCol': return drapeMode(cLat, cLon, R, hour, k, bg, false, true);
    case 'drapeBoth': return drapeMode(cLat, cLon, R, hour, k, bg, true, true);
    case 'barbs': return barbsMode(cLat, cLon, R, hour, k, bg);
    case 'isotachs': return isotachsMode(cLat, cLon, R, hour, k, bg);
    case 'layers': return profileArrows(cLat, cLon, R, hour, k);
    case 'rings': return ringsMode(cLat, cLon, R, k);
    case 'hodograph': return hodographMode(cLat, cLon, R, k);
    default: return [];
  }
}

// 2D draped on the terrain: animated arrows (vec) and/or a speed-coloured backdrop (col).
function drapeMode(cLat: number, cLon: number, R: number, hour: number, k: number, bg: [number, number], vec: boolean, col: boolean): any[] {
  const wk = `${Math.round(bg[0])}|${Math.round(bg[1])}`;
  const stale = !grid || grid.hour !== hour || grid.wk !== wk || Math.abs(Math.log(grid.R / R)) > 0.25
    || Math.hypot((grid.cLon - cLon) * grid.mLng, (grid.cLat - cLat) * grid.mLat) > R * 0.33;
  if (stale) { const g = buildGrid(cLat, cLon, R); if (g) { g.hour = hour; g.wk = wk; grid = g; parts = []; } }
  const g = grid; if (!g) return [];
  const out: any[] = col ? backdropLayers(g, k) : [];
  if (!vec) return out;

  interface Seg { s: Pos3; t: Pos3; a: number }
  const segs: Seg[] = [];
  for (const p of parts) {
    const w = sample(g, p.lon, p.lat), sp = Math.hypot(w.u, w.v);
    if (sp < 0.1 || Number.isNaN(w.h)) continue;
    const L = Math.min(STREAK_MAX, STREAK_K * sp), ue = w.u / sp, un = w.v / sp;   // length ∝ speed, downwind unit
    const tx = p.lon - ue * L / g.mLng, ty = p.lat - un * L / g.mLat;
    const th = sample(g, tx, ty).h, a = Math.round(210 * fade(p.age));
    const hz = w.h * k + OFF, head: Pos3 = [p.lon, p.lat, hz];
    segs.push({ s: [tx, ty, (Number.isNaN(th) ? w.h : th) * k + OFF], t: head, a });   // shaft
    const Lb = Math.min(120, L * 0.5), C = Math.cos(0.45), Sn = Math.sin(0.45);       // arrowhead barbs (±26°)
    for (const s of [1, -1]) { const rx = -ue * C - -un * (s * Sn), ry = -ue * (s * Sn) + -un * C; segs.push({ s: head, t: [p.lon + rx * Lb / g.mLng, p.lat + ry * Lb / g.mLat, hz], a }); }
  }
  out.push(new LineLayer<Seg>({
    id: 'wind-streaks', data: segs, getSourcePosition: (d: any) => d.s, getTargetPosition: (d: any) => d.t,
    getColor: (d: any) => [225, 236, 248, d.a], getWidth: 1.4, widthUnits: 'pixels', parameters: streakParams,
  } as any));
  return out;
}

// 2D: conventional station wind barbs on a grid, draped on the terrain. The staff
// points toward where the wind comes FROM; barbs sit on the left (N. hemisphere).
// Half barb = 5 kt, full = 10 kt, pennant = 50 kt; calm (< 1 kt) = a small circle.
// Speed is rounded to 5 kt. Uses the terrain-refined surface wind.
function barbsMode(cLat: number, cLon: number, R: number, hour: number, k: number, bg: [number, number]): any[] {
  const wk = `${Math.round(bg[0])}|${Math.round(bg[1])}`;
  const stale = !grid || grid.hour !== hour || grid.wk !== wk || Math.abs(Math.log(grid.R / R)) > 0.25
    || Math.hypot((grid.cLon - cLon) * grid.mLng, (grid.cLat - cLat) * grid.mLat) > R * 0.33;
  if (stale) { const bg2 = buildGrid(cLat, cLon, R); if (bg2) { bg2.hour = hour; bg2.wk = wk; grid = bg2; } }
  const g = grid; if (!g) return [];
  const mLng = g.mLng, mLat = g.mLat;
  const Ls = Math.max(500, Math.min(2400, R * 0.1)), Lb = Ls * 0.42, slot = Ls * 0.16;   // staff / barb / spacing (m)
  interface Seg { s: Pos3; t: Pos3 }
  const segs: Seg[] = [];
  for (const p of anchors(cLat, cLon, R * 0.92, mLng, mLat, 7)) {
    const w = sample(g, p.lon, p.lat); if (Number.isNaN(w.h)) continue;
    const sp = Math.hypot(w.u, w.v), kt = sp * 1.94384, z = w.h * k + OFF;
    if (kt < 1) {   // calm → small circle
      let prev: Pos3 | null = null; const rr = Ls * 0.12;
      for (let s = 0; s <= 16; s++) { const ang = s / 16 * 2 * Math.PI, pt: Pos3 = [p.lon + rr * Math.cos(ang) / mLng, p.lat + rr * Math.sin(ang) / mLat, z]; if (prev) segs.push({ s: prev, t: pt }); prev = pt; }
      continue;
    }
    const ue = w.u / sp, un = w.v / sp;                 // downwind unit
    const sux = -ue, suy = -un, lx = -suy, ly = sux;    // staff points upwind (FROM); barbs to its left (N. hem.)
    segs.push({ s: [p.lon, p.lat, z], t: [p.lon + sux * Ls / mLng, p.lat + suy * Ls / mLat, z] });   // staff
    const on = (d: number): Pos3 => [p.lon + sux * (Ls - d) / mLng, p.lat + suy * (Ls - d) / mLat, z];         // d metres in from the tip
    const barb = (b0: Pos3, len: number): Pos3 => [b0[0] + (lx * len + sux * len * 0.4) / mLng, b0[1] + (ly * len + suy * len * 0.4) / mLat, z]; // out-left, leaning to the tip
    const five = Math.round(kt / 5) * 5, pen = Math.floor(five / 50), rem = five % 50, full = Math.floor(rem / 10), half = Math.floor((rem % 10) / 5);
    let d = 0;
    for (let i = 0; i < pen; i++) { const b0 = on(d), b1 = on(d + slot); segs.push({ s: b0, t: barb(b0, Lb) }, { s: barb(b0, Lb), t: b1 }); d += slot; }   // pennant (triangle)
    if (pen) d += slot * 0.3;
    for (let i = 0; i < full; i++) { const b0 = on(d); segs.push({ s: b0, t: barb(b0, Lb) }); d += slot; }
    if (half) { const b0 = on((pen + full) === 0 ? slot : d); segs.push({ s: b0, t: barb(b0, Lb * 0.5) }); }     // lone half barb set in from the tip
  }
  return [new LineLayer<Seg>({
    id: 'wind-barbs', data: segs, getSourcePosition: (d: any) => d.s, getTargetPosition: (d: any) => d.t,
    getColor: [235, 242, 250, 235], getWidth: 1.6, widthUnits: 'pixels', parameters: streakParams,
  } as any)];
}

// Rebuild the drape grid if the view/hour/wind changed; return it (or null).
function ensureGrid(cLat: number, cLon: number, R: number, hour: number, bg: [number, number]): Grid | null {
  const wk = `${Math.round(bg[0])}|${Math.round(bg[1])}`;
  const stale = !grid || grid.hour !== hour || grid.wk !== wk || Math.abs(Math.log(grid.R / R)) > 0.25
    || Math.hypot((grid.cLon - cLon) * grid.mLng, (grid.cLat - cLat) * grid.mLat) > R * 0.33;
  if (stale) { const g = buildGrid(cLat, cLon, R); if (g) { g.hour = hour; g.wk = wk; grid = g; parts = []; } }
  return grid;
}

// Wind-speed colour for an isotach level (green calm → red strong).
function isoColor(L: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (L - 2) / 16)) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
  const s: [number, number, number][] = [[90, 200, 100], [225, 215, 80], [220, 80, 60]];
  const a = s[i], b = s[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

// 2D: isotachs (equal wind-speed contours) via marching squares on the terrain-
// refined speed field, over the speed-coloured backdrop. Draped on the terrain.
const ISO_LEVELS = [3, 6, 9, 12, 15, 18, 21, 24];    // m/s
const ISO_CONN: number[][][] = [[], [[3, 0]], [[0, 1]], [[1, 3]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[2, 3]], [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], []];
const ISO_CORN = [[0, 0], [1, 0], [1, 1], [0, 1]], ISO_EDGE = [[0, 1], [1, 2], [2, 3], [3, 0]];
interface IsoSeg { s: Pos3; t: Pos3; c: [number, number, number] }
let isoCache: { g: Grid; k: number; segs: IsoSeg[] } | null = null;
function isotachsMode(cLat: number, cLon: number, R: number, hour: number, k: number, bg: [number, number]): any[] {
  const g = ensureGrid(cLat, cLon, R, hour, bg); if (!g) return [];
  if (!isoCache || isoCache.g !== g || isoCache.k !== k) {
    const nlon = (i: number) => g.cLon + (-g.R + i * g.sp) / g.mLng, nlat = (j: number) => g.cLat + (-g.R + j * g.sp) / g.mLat;
    const spd = g.nodes.map(n => Number.isNaN(n.h) ? NaN : Math.hypot(n.u, n.v));
    const segs: IsoSeg[] = [];
    for (let j = 0; j < GN - 1; j++) for (let i = 0; i < GN - 1; i++) {
      const ni = ISO_CORN.map(([di, dj]) => (j + dj) * GN + (i + di));
      const hs = ni.map(x => g.nodes[x].h); if (hs.some(Number.isNaN)) continue;
      const vs = ni.map(x => spd[x]);
      for (const L of ISO_LEVELS) {
        const conns = ISO_CONN[(vs[0] >= L ? 1 : 0) | (vs[1] >= L ? 2 : 0) | (vs[2] >= L ? 4 : 0) | (vs[3] >= L ? 8 : 0)];
        if (!conns.length) continue;
        const c = isoColor(L);
        const pt = (e: number): Pos3 => {
          const [a, b] = ISO_EDGE[e], t = (L - vs[a]) / ((vs[b] - vs[a]) || 1e-9);
          const lonA = nlon(i + ISO_CORN[a][0]), latA = nlat(j + ISO_CORN[a][1]), lonB = nlon(i + ISO_CORN[b][0]), latB = nlat(j + ISO_CORN[b][1]);
          return [lonA + (lonB - lonA) * t, latA + (latB - latA) * t, (hs[a] + (hs[b] - hs[a]) * t) * k + 15];
        };
        for (const [e1, e2] of conns) segs.push({ s: pt(e1), t: pt(e2), c });
      }
    }
    isoCache = { g, k, segs };
  }
  return [...backdropLayers(g, k), new LineLayer<IsoSeg>({
    id: 'wind-isotachs', data: isoCache.segs, getSourcePosition: (d: any) => d.s, getTargetPosition: (d: any) => d.t,
    getColor: (d: any) => [...d.c, 240], getWidth: 2, widthUnits: 'pixels', parameters: streakParams,
  } as any)];
}

// The wind at each altitude band above the local surface (the vertical profile).
function computeBands(cLat: number, cLon: number): { alt: number; u: number; v: number }[] {
  const base = terrainElevAt(cLon, cLat) ?? (S.AF ? S.AF.elev : 0);
  return BAND_ALTS.map(da => { const w = windAtAlt(cLat, cLon, base + da) || [0, 0]; return { alt: base + da, u: w[0], v: w[1] }; });
}

// A coarse n×n grid of anchor points within the view disc.
function anchors(cLat: number, cLon: number, R: number, mLng: number, mLat: number, n: number): { lon: number; lat: number }[] {
  const out: { lon: number; lat: number }[] = [], step = (2 * R) / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + (i + 0.5) * step, y = -R + (j + 0.5) * step;
    if (x * x + y * y <= R * R) out.push({ lon: cLon + x / mLng, lat: cLat + y / mLat });
  }
  return out;
}

interface ColSeg { s: Pos3; t: Pos3; c: [number, number, number]; a: number }
const colLine = (id: string, data: ColSeg[], w: number): any => new LineLayer<ColSeg>({
  id, data, getSourcePosition: (d: any) => d.s, getTargetPosition: (d: any) => d.t,
  getColor: (d: any) => [...d.c, d.a], getWidth: w, widthUnits: 'pixels', parameters: streakParams,
} as any);

// 3D: animated arrows at altitude bands, each following the wind at its altitude —
// colour keyed to altitude so shear is visible.
function profileArrows(cLat: number, cLon: number, R: number, hour: number, k: number): any[] {
  const mLng = mPerLng(cLat), mLat = M_PER_LAT;
  bands = computeBands(cLat, cLon);
  const stale = !field || field.hour !== hour || Math.abs(Math.log(field.R / R)) > 0.25
    || Math.hypot((field.cLon - cLon) * field.mLng, (field.cLat - cLat) * field.mLat) > R * 0.33;
  if (stale) { field = { cLon, cLat, R, mLng, mLat, hour }; parts = []; }
  const f = field!;
  const segs: ColSeg[] = [];
  for (const p of parts) {
    const b = bands[p.band]; if (!b) continue;
    const sp = Math.hypot(b.u, b.v); if (sp < 0.1) continue;
    const L = Math.min(STREAK_MAX, STREAK_K * sp), ue = b.u / sp, un = b.v / sp;
    const z = b.alt * k, a = Math.round(215 * fade(p.age)), c = BAND_COLORS[p.band], head: Pos3 = [p.lon, p.lat, z];
    const tx = p.lon - ue * L / f.mLng, ty = p.lat - un * L / f.mLat;
    segs.push({ s: [tx, ty, z], t: head, c, a });
    const Lb = Math.min(120, L * 0.5), C = Math.cos(0.45), Sn = Math.sin(0.45);
    for (const s of [1, -1]) { const rx = -ue * C - -un * (s * Sn), ry = -ue * (s * Sn) + -un * C; segs.push({ s: head, t: [p.lon + rx * Lb / f.mLng, p.lat + ry * Lb / f.mLat, z], c, a }); }
  }
  return [colLine('wind-3d', segs, 1.7)];
}

// 3D: a ring of arrows per altitude band, stacked into towers over a coarse grid.
function ringsMode(cLat: number, cLon: number, R: number, k: number): any[] {
  const mLng = mPerLng(cLat), mLat = M_PER_LAT;
  const bands = computeBands(cLat, cLon), rr = Math.max(400, Math.min(1400, R * 0.06));
  const segs: ColSeg[] = [], NSEG = 22;
  for (const p of anchors(cLat, cLon, R * 0.92, mLng, mLat, 4)) {
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi], z = b.alt * k, c = BAND_COLORS[bi];
      let prev: Pos3 | null = null;
      for (let s = 0; s <= NSEG; s++) {
        const ang = s / NSEG * 2 * Math.PI, pt: Pos3 = [p.lon + rr * Math.cos(ang) / mLng, p.lat + rr * Math.sin(ang) / mLat, z];
        if (prev) segs.push({ s: prev, t: pt, c, a: 150 });
        prev = pt;
      }
      const sp = Math.hypot(b.u, b.v); if (sp < 0.1) continue;
      const ue = b.u / sp, un = b.v / sp, hL = p.lon + ue * rr / mLng, hLa = p.lat + un * rr / mLat, head: Pos3 = [hL, hLa, z];
      segs.push({ s: [p.lon - ue * rr / mLng, p.lat - un * rr / mLat, z], t: head, c, a: 230 });   // diameter arrow, downwind
      const Lb = rr * 0.5, C = Math.cos(0.5), Sn = Math.sin(0.5);
      for (const s of [1, -1]) { const rx = -ue * C - -un * (s * Sn), ry = -ue * (s * Sn) + -un * C; segs.push({ s: head, t: [hL + rx * Lb / mLng, hLa + ry * Lb / mLat, z], c, a: 230 }); }
    }
  }
  return [colLine('wind-rings', segs, 1.5)];
}

// 3D: a hodograph spiral per grid point — each band's wind vector tip, elevated to
// its altitude and connected, so the curve spirals when the wind veers with height.
function hodographMode(cLat: number, cLon: number, R: number, k: number): any[] {
  const mLng = mPerLng(cLat), mLat = M_PER_LAT;
  const bands = computeBands(cLat, cLon), scale = 45;   // metres per m/s
  const segs: ColSeg[] = [];
  for (const p of anchors(cLat, cLon, R * 0.9, mLng, mLat, 5)) {
    const z0 = bands[0].alt * k, zT = bands[bands.length - 1].alt * k;
    segs.push({ s: [p.lon, p.lat, z0], t: [p.lon, p.lat, zT], c: [150, 165, 185], a: 90 });   // faint vertical axis
    let prev: Pos3 | null = null;
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi], c = BAND_COLORS[bi];
      const tip: Pos3 = [p.lon + b.u * scale / mLng, p.lat + b.v * scale / mLat, b.alt * k];
      segs.push({ s: [p.lon, p.lat, b.alt * k], t: tip, c, a: 120 });     // spoke from axis to the tip
      if (prev) segs.push({ s: prev, t: tip, c, a: 235 });                // connect tips → the spiral
      prev = tip;
    }
  }
  return [colLine('wind-hodo', segs, 1.8)];
}
