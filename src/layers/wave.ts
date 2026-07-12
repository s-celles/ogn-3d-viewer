// ============ drawing the lee wave ============
// The physics lives in core/lift/wave.ts: it turns the DEM, the wind and the stability into
// a vertical velocity w and a streamline displacement η per node. Because the wave is an
// ELEVATED phenomenon, this file draws it not draped on the ground but as undulating
// **streamline sheets** stacked at several altitudes above the ridges — each rippling with
// η and tinted warm/blue by w, like the classic mountain-wave diagram — plus the ragged
// rotor clouds beneath the strongest crests. The "Onde" component of the lift potential.
import { S } from '../state';
import { SimpleMeshLayer, IconLayer, COORDINATE_SYSTEM, MapView } from '../deck';
import { mapDiv } from '../dom';
import { terrainElevAt } from '../terrain';
import { windBg } from '../wind-source';
import { cloudSprite } from '../airmass';
import { getWeather, weatherStability, wxEpoch } from '../weather';
import { SHEET_COLORS, sheetBand } from 'soaring-core/liftviz';
import { waveField, waveResonance, rotorSpots, type WaveField, type RotorSpot } from 'soaring-core/lift/wave';
import { M_PER_LAT, mPerLng, metresPerPixel, rad } from 'soaring-core/geo';

const RMIN = 7000, RMAX = 32000;   // m: wave-domain half-width bounds
const NODE_M = 640;      // m: target node spacing (drives the lattice size from the domain)
const WAVE_BASE = 200;   // m: lowest streamline sheet, above the highest ridge
const LEVELS = 6, DZ = 620;      // stacked streamline sheets and their spacing (m) → up ~3.3 km
const ETA_FLAT = 20;     // m: below this displacement AND below W_LO, the sheet is level → skip it
const READY_FRAC = 0.4;  // below this share of loaded nodes the terrain has not streamed in yet
const ROTOR_HGT = 220;   // m: height of the rotor / roll-cloud band above the terrain
const ROTOR_COL: [number, number, number, number] = [150, 142, 138, 205];   // dirty-grey ragged roll cloud

const meshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

interface Puff { pos: [number, number, number]; size: number }
interface Bin { pos: number[]; nrm: number[]; idx: number[] }

// One quad of an undulating streamline sheet: a horizontal cell whose four corners ride the
// wave's vertical displacement η — so the sheet ripples up and down downwind.
function addSheetQuad(b: Bin, f: WaveField, i: number, j: number, base: number, k: number): void {
  const n = f.grid.n, s = b.pos.length / 3, z = (idx: number) => (base + f.eta[idx]) * k;
  b.pos.push(
    f.lon[i], f.lat[j], z(j * n + i),
    f.lon[i + 1], f.lat[j], z(j * n + i + 1),
    f.lon[i + 1], f.lat[j + 1], z((j + 1) * n + i + 1),
    f.lon[i], f.lat[j + 1], z((j + 1) * n + i),
  );
  for (let m = 0; m < 4; m++) b.nrm.push(0, 0, 1);
  b.idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
}

const mkLayers = (meshes: { color: number[]; mesh: any }[], rotor: Puff[], alpha: number): any[] => {
  const ls: any[] = meshes.map((m, i) => new SimpleMeshLayer({
    id: 'wave-' + i, data: [{}], getPosition: () => [0, 0, 0], _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [m.color[0], m.color[1], m.color[2], Math.round(m.color[3] * alpha)],
    material: false, parameters: meshParams, mesh: m.mesh,
  } as any));
  if (rotor.length) ls.push(new IconLayer({
    id: 'wave-rotor', data: rotor, iconAtlas: cloudSprite(), iconMapping: { p: { x: 0, y: 0, width: 128, height: 128, mask: true } } as any,
    getIcon: () => 'p', getPosition: (d: any) => d.pos, getSize: (d: any) => d.size,
    getColor: [ROTOR_COL[0], ROTOR_COL[1], ROTOR_COL[2], Math.round(ROTOR_COL[3] * alpha)], sizeUnits: 'meters', billboard: true,
    parameters: { depthCompare: 'less-equal', depthWriteEnabled: false } as any,
  } as any));
  return ls;
};

let cache: { cLon: number; cLat: number; R: number; hour: number; wk: string; meshes: { color: number[]; mesh: any }[]; rotor: Puff[] } | null = null;

// Size + centre the wave domain to the VISIBLE terrain: in the overview we unproject a
// screen sample grid to the ground and take its (RMAX-capped) bounding box, so the wave
// fills the window rather than a small fixed box centred on the map centre. Falls back to
// a zoom-scaled square when unprojection isn't available (cockpit/chase, no canvas, tilt
// looking past the horizon). Returns a square (max span) — flat cells self-skip, so the
// overhang onto ridgeless ground/sea costs nothing visible.
function waveDomain(cLat: number, cLon: number, zoom: number): { cLon: number; cLat: number; R: number } {
  const fallback = { cLon, cLat, R: Math.max(RMIN, Math.min(RMAX, metresPerPixel(cLat, zoom) * 1100)) };
  if (S.mode !== 'over') return fallback;
  const width = mapDiv.clientWidth, height = mapDiv.clientHeight;
  if (!width || !height) return fallback;
  let vp: any;
  try { vp = new MapView({ id: 'main' }).makeViewport({ width, height, viewState: S.mapVS as any }); }
  catch { return fallback; }
  const cos = Math.cos(rad(cLat));
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity, hits = 0;
  const NS = 6;
  for (let a = 0; a <= NS; a++) for (let b = 0; b <= NS; b++) {
    const px = width * a / NS, py = height * (0.12 + 0.88 * b / NS);   // skip the top 12% (sky / near-horizon rays)
    let g: number[] | null = null;
    try { g = vp.unproject([px, py]); } catch { g = null; }
    if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) continue;
    const dx = (g[0] - cLon) * M_PER_LAT * cos, dy = (g[1] - cLat) * M_PER_LAT;
    if (Math.hypot(dx, dy) > RMAX) continue;                          // drop the far, near-horizon samples
    if (g[0] < minLon) minLon = g[0]; if (g[0] > maxLon) maxLon = g[0];
    if (g[1] < minLat) minLat = g[1]; if (g[1] > maxLat) maxLat = g[1];
    hits++;
  }
  if (hits < 4) return fallback;
  const Rx = (maxLon - minLon) / 2 * M_PER_LAT * cos, Ry = (maxLat - minLat) / 2 * M_PER_LAT;
  return { cLon: (minLon + maxLon) / 2, cLat: (minLat + maxLat) / 2, R: Math.max(RMIN, Math.min(RMAX, Math.max(Rx, Ry))) };
}

export function waveLayers(k: number, alpha = 1): any[] {
  if (alpha <= 0) return [];
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude, zoom = S.mapVS.zoom || 11;
  if (!S.wxSim.on && (S.source === 'file' || !S.date)) return [];
  const wind = windBg(cLat, cLon); if (!wind) return [];
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const wx = getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date);
  const res = waveResonance(wind, wx ? weatherStability(wx, hour) : NaN);
  if (!res) return [];   // no wind, no stability, or an implausible wavelength — no wave

  const dom = waveDomain(cLat, cLon, zoom);
  const gLon = dom.cLon, gLat = dom.cLat, R = dom.R;
  const n = Math.max(60, Math.min(100, Math.round(2 * R / NODE_M) + 1));   // resolution from the domain size, bounded for cost
  const wk = `${Math.round(wind[0])}|${Math.round(wind[1])}|${wxEpoch()}`;
  if (cache && cache.hour === hour && cache.wk === wk && Math.abs(Math.log(cache.R / R)) < 0.2) {
    const moved = Math.hypot((cache.cLon - gLon) * mPerLng(gLat), (cache.cLat - gLat) * M_PER_LAT);
    if (moved < R * 0.25) return mkLayers(cache.meshes, cache.rotor, alpha);
  }

  const f = waveField({ cLon: gLon, cLat: gLat, R, n }, terrainElevAt, wind, { res });
  if (f.ready < f.total * READY_FRAC) return [];   // terrain not loaded here yet — retry next frame

  // Build the stacked undulating sheets: each quad coloured by its vertical velocity, its
  // corners riding η, so the flow ripples over the ridges just like the textbook picture.
  const bins: Bin[] = SHEET_COLORS.map(() => ({ pos: [], nrm: [], idx: [] }));
  for (let lv = 0; lv < LEVELS; lv++) {
    const base = f.maxTerr + WAVE_BASE + lv * DZ;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const idx = j * n + i;
      if (!f.ok[idx] || !f.ok[idx + 1] || !f.ok[idx + n] || !f.ok[idx + n + 1]) continue;
      const band = sheetBand(f.w[idx]);
      if (band === 2 && Math.abs(f.eta[idx]) < ETA_FLAT) continue;   // no wave here → skip the flat sheet
      addSheetQuad(bins[band], f, i, j, base, k);
    }
  }
  const meshes = bins.map((b, i) => b.idx.length ? {
    color: SHEET_COLORS[i],
    mesh: {
      attributes: { POSITION: { value: new Float32Array(b.pos), size: 3 }, NORMAL: { value: new Float32Array(b.nrm), size: 3 } },
      indices: { value: new Uint32Array(b.idx), size: 1 }, mode: 4,
    },
  } : null).filter(Boolean) as { color: number[]; mesh: any }[];

  // Rotor: turbulent roll clouds low under the strongest crests — the hazard beneath the
  // smooth wave. The resonant decay concentrates them under the first crest downwind.
  const rotor: Puff[] = rotorSpots(f).map((s: RotorSpot) => ({
    pos: [s.lon, s.lat, (s.elev + ROTOR_HGT) * k] as [number, number, number], size: s.size,
  }));
  cache = { cLon: gLon, cLat: gLat, R, hour, wk, meshes, rotor };
  return mkLayers(meshes, rotor, alpha);
}
