// ============ lee waves (mountain wave / onde): resonant lift downwind of ridges ====
// When a stable airstream crosses a ridge with enough wind, it oscillates downwind as a
// standing wave: smooth lift in the crests, sink in the troughs, at the wavelength
//   λ = 2π·U / N                (U = cross-ridge wind, N = Brunt–Väisälä frequency)
// We take the terrain forcing along the wind (w₀ = wind·∇terrain) and convolve the
// UPWIND profile with a decaying sinusoid at the resonant wavenumber l = N/U — a linear,
// illustrative lee-wave response. Because the wave is an ELEVATED phenomenon, the flow is
// drawn as undulating **streamline sheets** stacked at several altitudes above the ridges
// — each ripples with the wave's vertical displacement η and is tinted warm/blue by the
// vertical velocity, like the classic mountain-wave diagram. Not draped on the ground.
// The "Onde" component of the lift potential. Rough (see the docs).
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM, MapView } from './deck';
import { mapDiv } from './dom';
import { terrainElevAt } from './terrain';
import { windBg } from './ridge';
import { getWeather, weatherStability, wxEpoch } from './weather';
import { LIFT_COLORS, SINK_COLORS } from './liftviz';

let NG = 80;             // grid nodes per side (set per call from the domain size, ~640 m spacing)
const RMIN = 7000, RMAX = 32000;   // m: wave-domain half-width bounds
const NODE_M = 640;      // m: target node spacing (drives NG from the domain size)
const GB = 140;          // terrain-gradient baseline (m)
const WIND_MIN = 7;      // m/s: weakest cross-ridge wind that makes wave (~25 km/h)
const N_MIN = 0.006;     // 1/s: weakest stability that makes wave
const LAMBDA_MIN = 2000, LAMBDA_MAX = 35000;   // m: plausible lee-wave wavelengths (wide, so strong wind keeps a wave)
const AMP = 1.6;         // display gain on the vertical-velocity (w) response
const WAVE_BASE = 200;   // m: lowest streamline sheet, above the highest ridge
const LEVELS = 6, DZ = 620;      // stacked streamline sheets and their spacing (m) → up ~3.3 km
const ETA_GAIN = 320;    // gain on the streamline vertical displacement η (m)
const ETA_MAX = 260;     // m: clamp η so sheets never cross
const W_LO = 0.4, W_HI = 1.2;    // |w| thresholds: neutral / mild / strong colouring
const NEUTRAL: [number, number, number, number] = [175, 205, 235, 30];   // faint band where the flow is level
// Streamline colour ramp by vertical velocity: strong up → mild up → level → mild down → strong down.
const SHEET = [LIFT_COLORS[4], LIFT_COLORS[2], NEUTRAL, SINK_COLORS[1], SINK_COLORS[0]];

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Bin { pos: number[]; nrm: number[]; idx: number[] }
// One quad of an undulating streamline sheet: a horizontal cell whose four corners ride
// the wave's vertical displacement η — so the sheet ripples up and down downwind.
function addSheetQuad(b: Bin, nlon: (i: number) => number, nlat: (j: number) => number, i: number, j: number, base: number, eta: Float32Array, k: number): void {
  const s = b.pos.length / 3, z = (n: number) => (base + eta[n]) * k;
  b.pos.push(nlon(i), nlat(j), z(j * NG + i), nlon(i + 1), nlat(j), z(j * NG + i + 1), nlon(i + 1), nlat(j + 1), z((j + 1) * NG + i + 1), nlon(i), nlat(j + 1), z((j + 1) * NG + i));
  for (let n = 0; n < 4; n++) b.nrm.push(0, 0, 1);
  b.idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
}

const mkLayers = (meshes: { color: number[]; mesh: any }[], alpha: number): any[] => meshes.map((m, i) => new SimpleMeshLayer({
  id: 'wave-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
  coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [m.color[0], m.color[1], m.color[2], Math.round(m.color[3] * alpha)],
  material: false, parameters: meshParams, mesh: m.mesh,
} as any));

let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; meshes: { color: number[]; mesh: any }[] } | null = null;

// Size + centre the wave domain to the VISIBLE terrain: in the overview we unproject a
// screen sample grid to the ground and take its (RMAX-capped) bounding box, so the wave
// fills the window rather than a small fixed box centred on the map centre. Falls back to
// a zoom-scaled square when unprojection isn't available (cockpit/chase, no canvas, tilt
// looking past the horizon). Returns a square (max span) — flat cells self-skip, so the
// overhang onto ridgeless ground/sea costs nothing visible.
function waveDomain(cLat: number, cLon: number, zoom: number): { cLon: number; cLat: number; R: number } {
  const mppx = 156543.03392 * Math.cos(cLat * Math.PI / 180) / 2 ** zoom;
  const fallback = { cLon, cLat, R: Math.max(RMIN, Math.min(RMAX, mppx * 1100)) };
  if (S.mode !== 'over') return fallback;
  const width = mapDiv.clientWidth, height = mapDiv.clientHeight;
  if (!width || !height) return fallback;
  let vp: any;
  try { vp = new MapView({ id: 'main' }).makeViewport({ width, height, viewState: S.mapVS as any }); }
  catch { return fallback; }
  const cos = Math.cos(cLat * Math.PI / 180);
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity, hits = 0;
  const NS = 6;
  for (let a = 0; a <= NS; a++) for (let b = 0; b <= NS; b++) {
    const px = width * a / NS, py = height * (0.12 + 0.88 * b / NS);   // skip the top 12% (sky / near-horizon rays)
    let g: number[] | null = null;
    try { g = vp.unproject([px, py]); } catch { g = null; }
    if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) continue;
    const dx = (g[0] - cLon) * 111320 * cos, dy = (g[1] - cLat) * 111320;
    if (Math.hypot(dx, dy) > RMAX) continue;                          // drop the far, near-horizon samples
    if (g[0] < minLon) minLon = g[0]; if (g[0] > maxLon) maxLon = g[0];
    if (g[1] < minLat) minLat = g[1]; if (g[1] > maxLat) maxLat = g[1];
    hits++;
  }
  if (hits < 4) return fallback;
  const Rx = (maxLon - minLon) / 2 * 111320 * cos, Ry = (maxLat - minLat) / 2 * 111320;
  return { cLon: (minLon + maxLon) / 2, cLat: (minLat + maxLat) / 2, R: Math.max(RMIN, Math.min(RMAX, Math.max(Rx, Ry))) };
}

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
  const dom = waveDomain(cLat, cLon, zoom);
  const gLon = dom.cLon, gLat = dom.cLat, R = dom.R;
  NG = Math.max(60, Math.min(100, Math.round(2 * R / NODE_M) + 1));   // resolution from the domain size, bounded for cost
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.2) {
    const cosLat = Math.cos(gLat * Math.PI / 180);
    const moved = Math.hypot((cache.cLon - gLon) * 111320 * cosLat, (cache.cLat - gLat) * 111320);
    if (moved < R * 0.25) return mkLayers(cache.meshes, alpha);
  }
  const mLng = 111320 * Math.cos(gLat * Math.PI / 180), mLat = 111320, sp = (2 * R) / (NG - 1);
  const nlon = (i: number) => gLon + (-R + i * sp) / mLng, nlat = (j: number) => gLat + (-R + j * sp) / mLat;
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
  // Pass 2: convolve the upwind forcing with a decaying resonant kernel per node — the
  // vertical velocity w (sin) for the colour, and the streamline displacement η (cos, a
  // quarter-wave out of phase) for the vertical ripple of the sheets.
  const uE = -wind[0] / spd, uN = -wind[1] / spd;                          // upwind unit vector
  const Ld = 2.5 * lambda, Lmax = Math.min(3 * lambda, R * 1.7), stepM = lambda / 9;
  const wN = new Float32Array(NG * NG), etaN = new Float32Array(NG * NG);
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const idx = j * NG + i; if (!ok[idx]) continue;
    let ws = 0, we = 0;
    for (let s = stepM; s <= Lmax; s += stepM) {
      const si = Math.round(i + uE * s / sp), sj = Math.round(j + uN * s / sp);
      if (si < 0 || si >= NG || sj < 0 || sj >= NG) break;
      const fi = sj * NG + si; if (!ok[fi]) continue;
      const dec = Math.exp(-s / Ld);
      ws += F[fi] * Math.sin(l * s) * dec; we += F[fi] * Math.cos(l * s) * dec;
    }
    wN[idx] = ws * AMP * stepM / lambda;
    etaN[idx] = Math.max(-ETA_MAX, Math.min(ETA_MAX, we * ETA_GAIN * stepM / lambda));
  }
  // Build the stacked undulating sheets: each quad coloured by its vertical velocity, its
  // corners riding η, so the flow ripples over the ridges just like the textbook picture.
  const bins: Bin[] = SHEET.map(() => ({ pos: [], nrm: [], idx: [] }));
  for (let lv = 0; lv < LEVELS; lv++) {
    const base = maxTerr + WAVE_BASE + lv * DZ;
    for (let j = 0; j < NG - 1; j++) for (let i = 0; i < NG - 1; i++) {
      const idx = j * NG + i;
      if (!ok[idx] || !ok[idx + 1] || !ok[idx + NG] || !ok[idx + NG + 1]) continue;
      const w = wN[idx];
      if (Math.abs(w) < W_LO && Math.abs(etaN[idx]) < 20) continue;         // no wave here → skip the flat sheet
      const b = w >= W_HI ? 0 : w >= W_LO ? 1 : w > -W_LO ? 2 : w > -W_HI ? 3 : 4;
      addSheetQuad(bins[b], nlon, nlat, i, j, base, etaN, k);
    }
  }
  const meshes = bins.map((b, i) => b.idx.length ? {
    color: SHEET[i],
    mesh: {
      attributes: { POSITION: { value: new Float32Array(b.pos), size: 3 }, NORMAL: { value: new Float32Array(b.nrm), size: 3 } },
      indices: { value: new Uint32Array(b.idx), size: 1 }, mode: 4,
    },
  } : null).filter(Boolean) as { color: number[]; mesh: any }[];
  cache = { cLon: gLon, cLat: gLat, R, hour, wk, meshes };
  return mkLayers(meshes, alpha);
}
