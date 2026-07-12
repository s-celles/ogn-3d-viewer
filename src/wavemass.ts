// ============ observed wave: straight sustained climbs reconstructed from tracks =====
// A thermal climb circles; a WAVE climb is smooth and nearly straight (the glider beats
// into wind, well above the ridges). Our thermal detector needs ≥1 full turn, so it
// rejects wave — this module catches the opposite: sustained climbs with a LOW turn rate
// and a good height above the terrain. Each becomes a vertical violet ribbon (a wave
// bar) at the climb, so the invisible lee-wave lift becomes geometry. Rough — see docs.
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { posAt } from './flight-math';
import { terrainElevAt } from './terrain';
import type { RenderTrack } from './types';
import { M_PER_LAT, mPerLng, distM } from './core/geo';

interface WaveClimb { t0: number; t1: number; base: number; top: number; strength: number; c: [number, number]; hdg: number }

// ---- detection tunables ----
const STEP = 4;          // resample step (s)
const HW = 10;           // s: heading baseline half-window
const TURN_MAX = 3.2;    // deg/s: below this the flight is "straight" (not circling)
const CLIMB_MIN = 0.25;  // m/s: minimum sustained climb over the window
const GAP = 30;          // s: bridge brief interruptions
const MIN_RUN = 90;      // s: shortest wave climb kept (waves are long)
const MIN_GAIN = 200;    // m: shortest climb kept
const MIN_STRENGTH = 0.4;// m/s: weakest climb kept
const MAX_NET = 300;     // deg: net heading swept must stay below (else it's circling)
const AGL_MIN = 250;     // m: the top must clear the terrain by this (excludes ridge beats)
const MERGE_M = 900;     // m: merge nearby climbs (same wave, several beats/gliders)
const MAX_WAVE = 40;     // cap rendered, strongest first

interface Samp { t: number; lon: number; lat: number; alt: number; hdg: number }

const bearing = (aLon: number, aLat: number, bLon: number, bLat: number): number => {
  const lat = (aLat + bLat) / 2 * Math.PI / 180;
  return (Math.atan2((bLon - aLon) * Math.cos(lat), bLat - aLat) * 180 / Math.PI + 360) % 360;
};

function makeWave(run: Samp[]): WaveClimb | null {
  const t0 = run[0].t, t1 = run[run.length - 1].t, dur = t1 - t0;
  if (dur < MIN_RUN) return null;
  let net = 0, base = Infinity, top = -Infinity, cx = 0, cy = 0, hx = 0, hy = 0;
  for (let i = 0; i < run.length; i++) {
    const s = run[i];
    base = Math.min(base, s.alt); top = Math.max(top, s.alt); cx += s.lon; cy += s.lat;
    hx += Math.sin(s.hdg * Math.PI / 180); hy += Math.cos(s.hdg * Math.PI / 180);
    if (i) net += ((s.hdg - run[i - 1].hdg + 540) % 360) - 180;
  }
  if (Math.abs(net) > MAX_NET) return null;                 // really circling → not wave
  const gain = top - base; if (gain < MIN_GAIN) return null;
  const strength = gain / dur; if (strength < MIN_STRENGTH) return null;
  const c: [number, number] = [cx / run.length, cy / run.length];
  const g = terrainElevAt(c[0], c[1]); if (g != null && top - g < AGL_MIN) return null;   // too close to the ground → ridge beat
  return { t0, t1, base, top, strength, c, hdg: (Math.atan2(hx, hy) * 180 / Math.PI + 360) % 360 };
}

// Straight-climb runs in one track: low turn rate + sustained climb, brief dips bridged.
function detectWave(tr: RenderTrack): WaveClimb[] {
  const out: WaveClimb[] = [];
  if (tr.rend - tr.rstart < MIN_RUN) return out;
  const s: Samp[] = [];
  for (let t = tr.rstart; t <= tr.rend; t += STEP) { const p = posAt(tr, t); s.push({ t, lon: p[0], lat: p[1], alt: p[2], hdg: 0 }); }
  const n = s.length; if (n < 4) return out;
  for (let i = 0; i < n; i++) {
    const a = posAt(tr, Math.max(tr.rstart, s[i].t - HW)), b = posAt(tr, Math.min(tr.rend, s[i].t + HW));
    s[i].hdg = bearing(a[0], a[1], b[0], b[1]);
  }
  const g = Math.max(1, Math.round(HW / STEP));
  const straightClimb = s.map((_, i) => {
    const a = s[Math.max(0, i - g)], b = s[Math.min(n - 1, i + g)];
    const turn = Math.abs(((b.hdg - a.hdg + 540) % 360) - 180) / (2 * g * STEP);   // deg/s
    const climb = (b.alt - a.alt) / (2 * g * STEP);                                // m/s
    return turn < TURN_MAX && climb > CLIMB_MIN;
  });
  let i = 0;
  while (i < n) {
    if (!straightClimb[i]) { i++; continue; }
    let last = i, gap = 0, k = i + 1;
    while (k < n) { if (straightClimb[k]) { last = k; gap = 0; } else if ((gap += STEP) > GAP) break; k++; }
    const w = makeWave(s.slice(i, last + 1)); if (w) out.push(w);
    i = last + 1;
  }
  return out;
}

const overlap = (a: WaveClimb, b: WaveClimb): boolean => a.t0 <= b.t1 + 60 && b.t0 <= a.t1 + 60;
function merge(list: WaveClimb[]): WaveClimb[] {
  const merged: WaveClimb[] = [];
  for (const w of list.slice().sort((a, b) => a.t0 - b.t0)) {
    const m = merged.find(x => overlap(x, w) && distM(x.c[0], x.c[1], w.c[0], w.c[1]) < MERGE_M);
    if (!m) { merged.push({ ...w }); continue; }
    m.t0 = Math.min(m.t0, w.t0); m.t1 = Math.max(m.t1, w.t1);
    m.base = Math.min(m.base, w.base); m.top = Math.max(m.top, w.top);
    m.strength = Math.max(m.strength, w.strength);
    m.c = [(m.c[0] + w.c[0]) / 2, (m.c[1] + w.c[1]) / 2];
  }
  return merged;
}

let cache: { tracks: RenderTrack[]; off: number; waves: WaveClimb[] } | null = null;
/** Detected wave climbs for the loaded day, memoised on the track set + geoid offset. */
export function getWaveClimbs(): WaveClimb[] {
  if (cache && cache.tracks === S.TRACKS && cache.off === S.altOffset) return cache.waves;
  const all: WaveClimb[] = [];
  for (const tr of S.TRACKS) all.push(...detectWave(tr));
  const waves = merge(all).sort((a, b) => b.strength - a.strength).slice(0, MAX_WAVE);
  cache = { tracks: S.TRACKS, off: S.altOffset, waves };
  return waves;
}

// ---- rendering ----
const FADE = 180;        // s: bars linger this long around the active window
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
function visAt(w: WaveClimb, t: number): number {
  if (t < w.t0 - FADE || t > w.t1 + FADE) return 0;
  if (t < w.t0) return smooth((t - (w.t0 - FADE)) / FADE);
  if (t > w.t1) return smooth((w.t1 + FADE - t) / FADE);
  return 1;
}

const anchor = [{}];
const barParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
};

/** deck layers for the observed wave at the current cursor: vertical violet ribbons
 *  (wave bars) aligned with the climb heading, from base to top, fading in and out. */
export function waveMassLayers(k: number): any[] {
  const t = S.cur, waves = getWaveClimbs();
  if (!waves.length) return [];
  const active = waves.map(w => ({ w, v: visAt(w, t) })).filter(x => x.v > 0.05);
  if (!active.length) return [];
  const L = 500;   // half-length of the ribbon along the heading (m)
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const { w } of active) {
    const [lon, lat] = w.c, mLng = mPerLng(lat), mLat = M_PER_LAT;
    const dx = Math.sin(w.hdg * Math.PI / 180) * L, dy = Math.cos(w.hdg * Math.PI / 180) * L;   // along the beat direction
    const aLon = lon - dx / mLng, aLat = lat - dy / mLat, bLon = lon + dx / mLng, bLat = lat + dy / mLat;
    const st = pos.length / 3, zb = w.base * k, zt = w.top * k;
    pos.push(aLon, aLat, zb, bLon, bLat, zb, bLon, bLat, zt, aLon, aLat, zt);
    for (let n = 0; n < 4; n++) nrm.push(0, 0, 1);
    idx.push(st, st + 1, st + 2, st, st + 2, st + 3);
  }
  return [new SimpleMeshLayer({
    id: 'wavemass', data: anchor, getPosition: () => [0, 0, 0], _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getColor: [175, 140, 225, 40], material: false,
    parameters: barParams,
    mesh: {
      attributes: { POSITION: { value: new Float32Array(pos), size: 3 }, NORMAL: { value: new Float32Array(nrm), size: 3 } },
      indices: { value: new Uint32Array(idx), size: 1 }, mode: 4,
    } as any,
  } as any)];
}
