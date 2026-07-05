// ============ air-mass reconstruction: thermals from OGN tracks ============
// A glider is an atmospheric probe: where one circles while gaining height, the
// air is rising. We detect circling-climb runs across every track, merge the
// ones that overlap in space and time (several gliders in the same thermal), and
// expose them as drifting columns + cumulus at their top — so the invisible lift
// becomes visible geometry, independent of the individual glider trails.
import { S } from './state';
import { SimpleMeshLayer, IconLayer, COORDINATE_SYSTEM } from './deck';
import { posAt } from './flight-math';
import { getWeather, weatherCloudbase, weatherWind } from './weather';
import type { RenderTrack, Pos3 } from './types';

export interface Thermal {
  t0: number; t1: number;         // active window (relative seconds)
  base: number; top: number;      // altitude band (m, orthometric)
  strength: number;               // representative climb (m/s)
  c0: [number, number];           // centre (lon,lat) early in the climb
  c1: [number, number];           // centre (lon,lat) late — the pair encodes wind drift
}

// ---- detection tunables ----
const STEP = 3;          // resample step (s)
const W = 9;             // s: heading baseline half-window — smooths ~10 s beacon noise
const TURN_MIN = 4;      // deg/s: sustained turn rate that counts as circling
const GAP = 21;          // s: bridge brief circling interruptions, so a climb stays one thermal
const MIN_RUN = 24;      // s: shortest circling run kept
const MIN_TURN = 360;    // deg: net heading swept (≥1 full turn) — rejects ridge S-turns
const MIN_GAIN = 80;     // m: shortest climb kept
const MIN_STRENGTH = 0.3;// m/s: weakest climb kept
const MERGE_M = 500;     // m: centres closer than this (with overlapping time) merge
const MAX_THERMALS = 60; // cap rendered, strongest first

interface Samp { t: number; lon: number; lat: number; alt: number; hdg: number }

const bearing = (aLon: number, aLat: number, bLon: number, bLat: number): number => {
  const lat = (aLat + bLat) / 2 * Math.PI / 180;
  const e = (bLon - aLon) * Math.cos(lat), n = bLat - aLat;
  return (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
};
// Smoothed heading at time t: bearing over a ±W window, robust to sparse beacons.
const hdgAt = (tr: RenderTrack, t: number): number => {
  const a = posAt(tr, Math.max(tr.rstart, t - W)), b = posAt(tr, Math.min(tr.rend, t + W));
  return bearing(a[0], a[1], b[0], b[1]);
};
const meanPos = (ss: Samp[]): [number, number] => {
  let x = 0, y = 0; for (const s of ss) { x += s.lon; y += s.lat; }
  return [x / ss.length, y / ss.length];
};
const metres = (aLon: number, aLat: number, bLon: number, bLat: number): number => {
  const lat = (aLat + bLat) / 2 * Math.PI / 180;
  return Math.hypot((bLon - aLon) * 111320 * Math.cos(lat), (bLat - aLat) * 111320);
};

function makeThermal(run: Samp[]): Thermal | null {
  const t0 = run[0].t, t1 = run[run.length - 1].t, dur = t1 - t0;
  if (dur < MIN_RUN) return null;
  let net = 0;                                            // net signed heading swept
  for (let i = 1; i < run.length; i++) net += ((run[i].hdg - run[i - 1].hdg + 540) % 360) - 180;
  if (Math.abs(net) < MIN_TURN) return null;              // not really circling (e.g. ridge beats)
  let base = Infinity, top = -Infinity;
  for (const s of run) { base = Math.min(base, s.alt); top = Math.max(top, s.alt); }
  const gain = top - base;
  if (gain < MIN_GAIN) return null;
  const strength = gain / dur;
  if (strength < MIN_STRENGTH) return null;
  const k = Math.max(1, Math.floor(run.length / 3));
  return { t0, t1, base, top, strength, c0: meanPos(run.slice(0, k)), c1: meanPos(run.slice(-k)) };
}

// Find every circling-climb run in one track. Circling is a smoothed turn rate
// over threshold; brief dips (GAP seconds) are bridged so one continuous climb
// stays a single thermal instead of shattering into fragments.
function detectClimbs(tr: RenderTrack): Thermal[] {
  const out: Thermal[] = [];
  if (tr.rend - tr.rstart < MIN_RUN) return out;
  const s: Samp[] = [];
  for (let t = tr.rstart; t <= tr.rend; t += STEP) { const p = posAt(tr, t); s.push({ t, lon: p[0], lat: p[1], alt: p[2], hdg: 0 }); }
  const n = s.length;
  for (let i = 0; i < n; i++) s[i].hdg = hdgAt(tr, s[i].t);
  const g = Math.max(1, Math.round(W / STEP));
  const circ = s.map((_, i) => {
    const a = s[Math.max(0, i - g)].hdg, b = s[Math.min(n - 1, i + g)].hdg;
    return Math.abs(((b - a + 540) % 360) - 180) / (2 * g * STEP) >= TURN_MIN;   // deg/s
  });
  let i = 0;
  while (i < n) {
    if (!circ[i]) { i++; continue; }
    let last = i, gap = 0, k = i + 1;
    while (k < n) {
      if (circ[k]) { last = k; gap = 0; }
      else if ((gap += STEP) > GAP) break;
      k++;
    }
    const th = makeThermal(s.slice(i, last + 1));
    if (th) out.push(th);
    i = last + 1;
  }
  return out;
}

const mid = (th: Thermal): [number, number] => [(th.c0[0] + th.c1[0]) / 2, (th.c0[1] + th.c1[1]) / 2];
const overlap = (a: Thermal, b: Thermal): boolean => a.t0 <= b.t1 + 60 && b.t0 <= a.t1 + 60;

// Collapse thermals from different gliders that are the same air: overlapping in
// time and within MERGE_M horizontally. Keeps the widest window / band, the
// strongest climb, and the activity-averaged centres.
function merge(list: Thermal[]): Thermal[] {
  const merged: Thermal[] = [];
  for (const th of list.slice().sort((a, b) => a.t0 - b.t0)) {
    const m = merged.find(x => overlap(x, th) && metres(mid(x)[0], mid(x)[1], mid(th)[0], mid(th)[1]) < MERGE_M);
    if (!m) { merged.push({ ...th }); continue; }
    m.t0 = Math.min(m.t0, th.t0); m.t1 = Math.max(m.t1, th.t1);
    m.base = Math.min(m.base, th.base); m.top = Math.max(m.top, th.top);
    m.strength = Math.max(m.strength, th.strength);
    m.c0 = [(m.c0[0] + th.c0[0]) / 2, (m.c0[1] + th.c0[1]) / 2];
    m.c1 = [(m.c1[0] + th.c1[0]) / 2, (m.c1[1] + th.c1[1]) / 2];
  }
  return merged;
}

let cache: { tracks: RenderTrack[]; off: number; thermals: Thermal[] } | null = null;
/** Detected thermals for the loaded day, memoised on the track set + geoid offset. */
export function getThermals(): Thermal[] {
  if (cache && cache.tracks === S.TRACKS && cache.off === S.altOffset) return cache.thermals;
  const all: Thermal[] = [];
  for (const tr of S.TRACKS) all.push(...detectClimbs(tr));
  const thermals = merge(all).sort((a, b) => b.strength - a.strength).slice(0, MAX_THERMALS);
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
  const mLng = 111320 * Math.cos(latB * Math.PI / 180), mLat = 111320;
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
  const mLat = 111320, mLng = 111320 * Math.cos(latB * Math.PI / 180);
  const off = Math.hypot(dLon * mLng, dLat * mLat), cap = Math.max(1, topAlt - base);
  if (off > cap) { const s = cap / off; dLon *= s; dLat *= s; }
  return [lonB + dLon, latB + dLat];
}

// Deterministic 0..1 hash, so per-cloud jitter is stable across frames.
const hash = (n: number): number => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

// A lobed cumulus silhouette (cauliflower top, flatter base) as an alpha mask,
// built once. Tinted white with per-cloud opacity at draw time.
let cloud: string | null = null;
function cloudSprite(): string {
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
    const mLngC = 111320 * Math.cos(lat * Math.PI / 180);
    const dLonS = wind ? wind[0] / mLngC : (th.c1[0] - th.c0[0]) / dur;
    const dLatS = wind ? wind[1] / 111320 : (th.c1[1] - th.c0[1]) / dur;
    const [lonT, latT] = leanBy(lon, lat, th.base, colTop, th.strength, dLonS, dLatS);
    addColumn(pos, nrm, idx, lon, lat, lonT, latT, th.base, colTop, R, k);
    if (th.top < cloudbase - 150) continue;                          // dry thermal → no cumulus
    const [clon, clat] = leanBy(lon, lat, th.base, cloudbase, th.strength, dLonS, dLatS);
    const z = cloudbase * k, mLng = 111320 * Math.cos(clat * Math.PI / 180), mLat = 111320, sz = R * 3.5;
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
