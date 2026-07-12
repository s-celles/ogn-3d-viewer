// ============ drawing the air mass the gliders found ============
// The detection lives in soaring-core/airmass: a glider circling while it gains height IS a
// thermal marker. This file is the viewer's half — it turns the loaded tracks into probes,
// memoises the day's thermals, and draws them as drifting columns with cumulus on top, so
// the invisible lift becomes geometry independent of the individual trails.
import { S } from './state';
import { SimpleMeshLayer, IconLayer, COORDINATE_SYSTEM } from './deck';
import { posAt } from './flight-math';
import { getWeather, weatherCloudbase, weatherWind } from './weather';
import type { RenderTrack, Pos3 } from './types';
import { M_PER_LAT, mPerLng } from 'soaring-core/geo';
import { detectThermals, MIN_STRENGTH, type Thermal } from 'soaring-core/airmass';
import type { Probe } from 'soaring-core/ports';

export type { Thermal };

/** A loaded track, seen as the atmospheric probe the kernel wants. */
const asProbe = (tr: RenderTrack): Probe => ({ rstart: tr.rstart, rend: tr.rend, at: t => posAt(tr, t) });

let cache: { tracks: RenderTrack[]; off: number; thermals: Thermal[] } | null = null;
/** Detected thermals for the loaded day, memoised on the track set + geoid offset. */
export function getThermals(): Thermal[] {
  if (cache && cache.tracks === S.TRACKS && cache.off === S.altOffset) return cache.thermals;
  const thermals = detectThermals(S.TRACKS.map(asProbe));
  cache = { tracks: S.TRACKS, off: S.altOffset, thermals };
  return thermals;
}

// ---- rendering ----
const FADE = 150;        // s: columns/cumulus linger this long around the active window
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
// Visibility 0..1 at time t: ramps up over [t0-FADE,t0], full during, ramps down.
function visAt(th: Thermal, t: number): number {
  if (t < th.t0 - FADE || t > th.t1 + FADE) return 0;
  if (t < th.t0) return smooth((t - (th.t0 - FADE)) / FADE);
  if (t > th.t1) return smooth((th.t1 + FADE - t) / FADE);
  return 1;
}
// Centre at time t: drifts from c0 to c1 across the climb (clamped in the fades).
function centreAt(th: Thermal, t: number): [number, number] {
  const f = Math.max(0, Math.min(1, (t - th.t0) / Math.max(1, th.t1 - th.t0)));
  return [th.c0[0] + (th.c1[0] - th.c0[0]) * f, th.c0[1] + (th.c1[1] - th.c0[1]) * f];
}

// A slim, wind-leaned plume (a soft chimney feeding the cloud) added to a shared
// mesh. lonB/latB is the base centre, lonT/latT the top centre (offset downwind).
function addColumn(pos: number[], nrm: number[], idx: number[], lonB: number, latB: number, lonT: number, latT: number, base: number, top: number, R: number, k: number): void {
  const mLng = mPerLng(latB), mLat = M_PER_LAT;
  const zb = base * k, zt = top * k, rb = R * 0.6, rt = R * 0.85, N = 12, start = pos.length / 3;
  for (let i = 0; i < N; i++) {
    const a = i / N * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    pos.push(lonB + rb * ca / mLng, latB + rb * sa / mLat, zb); nrm.push(0, 0, 1);   // base ring
    pos.push(lonT + rt * ca / mLng, latT + rt * sa / mLat, zt); nrm.push(0, 0, 1);   // top ring (downwind)
  }
  for (let i = 0; i < N; i++) {
    const b0 = start + i * 2, t0 = b0 + 1, b1 = start + ((i + 1) % N) * 2, t1 = b1 + 1;
    idx.push(b0, b1, t0, t0, b1, t1);
  }
}

// Downwind lean of a point at altitude topAlt vs the base: the air rising there
// drifts for (rise/strength) seconds at the wind velocity (deg/s). Capped at 45°.
function leanBy(lonB: number, latB: number, base: number, topAlt: number, strength: number, dLonS: number, dLatS: number): [number, number] {
  const rise = (topAlt - base) / Math.max(MIN_STRENGTH, strength);
  let dLon = dLonS * rise, dLat = dLatS * rise;
  const mLat = M_PER_LAT, mLng = mPerLng(latB);
  const off = Math.hypot(dLon * mLng, dLat * mLat), cap = Math.max(1, topAlt - base);
  if (off > cap) { const s = cap / off; dLon *= s; dLat *= s; }
  return [lonB + dLon, latB + dLat];
}

// Deterministic 0..1 hash, so per-cloud jitter is stable across frames.
const hash = (n: number): number => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

// A lobed cumulus silhouette (cauliflower top, flatter base) as an alpha mask,
// built once. Tinted white with per-cloud opacity at draw time. Shared with the
// lift-potential layer (predicted cumulus on a cu day).
let cloud: string | null = null;
export function cloudSprite(): string {
  if (cloud) return cloud;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const lobes: [number, number, number][] = [[64, 84, 30], [42, 82, 22], [86, 82, 22], [30, 86, 15], [98, 86, 15], [52, 62, 23], [78, 60, 23], [64, 48, 25]];
  for (const [cx, cy, r] of lobes) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 2 * Math.PI); x.fill();
  }
  return (cloud = c.toDataURL());
}

const anchor = [{}];
const colParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

/** deck layers for the air mass at the current cursor: slim lift plumes topped by
 *  cumulus at a common cloudbase (dry thermals stay cloudless), fading in and out
 *  as the day is scrubbed. */
export function airMassLayers(k: number): any[] {
  const t = S.cur, ths = getThermals();
  if (!ths.length) return [];
  // Weather (Open-Meteo) refines the picture when available; else fall back to the
  // track-derived estimates. Both are rough — see the docs.
  const wx = S.AF && S.source !== 'file' && S.date ? getWeather(S.AF.lat, S.AF.lon, S.date) : null;
  const hour = Math.floor((S.G0 + t) / 3600);
  // Cloudbase: measured LCL from the weather, else a high percentile of the tops.
  const tops = ths.map(x => x.top).sort((a, b) => a - b);
  const cloudbase = (wx && weatherCloudbase(wx, hour)) || tops[Math.min(tops.length - 1, Math.floor(tops.length * 0.8))];
  const active = ths.map(th => ({ th, v: visAt(th, t) })).filter(x => x.v > 0.02);
  if (!active.length) return [];
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const puffs: { pos: Pos3; size: number; alpha: number; angle: number }[] = [];
  for (const { th, v } of active) {
    const [lon, lat] = centreAt(th, t);
    const R = 40 + Math.min(3, th.strength) * 22;                    // plume radius (m)
    const colTop = Math.min(th.top, cloudbase);                      // plume stops at the cloudbase
    // Wind for the lean: the weather profile at mid-height, else the circle drift.
    const dur = Math.max(1, th.t1 - th.t0);
    const wind = wx ? weatherWind(wx, hour, (th.base + colTop) / 2) : null;
    const mLngC = mPerLng(lat);
    const dLonS = wind ? wind[0] / mLngC : (th.c1[0] - th.c0[0]) / dur;
    const dLatS = wind ? wind[1] / M_PER_LAT : (th.c1[1] - th.c0[1]) / dur;
    const [lonT, latT] = leanBy(lon, lat, th.base, colTop, th.strength, dLonS, dLatS);
    addColumn(pos, nrm, idx, lon, lat, lonT, latT, th.base, colTop, R, k);
    if (th.top < cloudbase - 150) continue;                          // dry thermal → no cumulus
    const [clon, clat] = leanBy(lon, lat, th.base, cloudbase, th.strength, dLonS, dLatS);
    const z = cloudbase * k, mLng = mPerLng(clat), mLat = M_PER_LAT, sz = R * 3.5;
    // A little cluster (main + satellites) so the cloud is lumpy, not a single blob.
    const lobes: [number, number, number][] = [[0, 0, 1], [0.75, 0.15, 0.6], [-0.65, -0.1, 0.62], [0.15, -0.6, 0.5]];
    lobes.forEach(([dx, dy, sc], j) => {
      const h = hash(th.t0 + j * 57.3);
      puffs.push({
        pos: [clon + dx * R / mLng, clat + dy * R / mLat, z + (sc - 0.6) * R],
        size: sz * sc * (0.85 + 0.3 * h), alpha: Math.round((j ? 185 : 225) * v), angle: (h - 0.5) * 40,
      });
    });
  }
  const mesh = {
    attributes: { POSITION: { value: new Float32Array(pos), size: 3 }, NORMAL: { value: new Float32Array(nrm), size: 3 } },
    indices: { value: new Uint32Array(idx), size: 1 }, mode: 4,
  };
  return [
    new SimpleMeshLayer({
      id: 'airmass-cols', data: anchor, getPosition: () => [0, 0, 0], _instanced: false,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT, mesh: mesh as any, getColor: [180, 205, 235, 22], material: false,
      parameters: colParams,
    } as any),
    new IconLayer({
      id: 'airmass-clouds', data: puffs,
      iconAtlas: cloudSprite(), iconMapping: { p: { x: 0, y: 0, width: 128, height: 128, mask: true } } as any,
      getIcon: () => 'p', getPosition: (d: any) => d.pos, getSize: (d: any) => d.size, getAngle: (d: any) => d.angle,
      getColor: (d: any) => [255, 255, 255, d.alpha], sizeUnits: 'meters', billboard: true,
      parameters: { depthCompare: 'less-equal', depthWriteEnabled: false } as any,
    } as any),
  ];
}
