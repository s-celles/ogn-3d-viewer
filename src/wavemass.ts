// ============ drawing the wave the gliders found ============
// The detection lives in soaring-core/wavemass: a wave climb is straight, sustained, and high
// above the ground — the mirror image of a thermal, and what the thermal detector throws
// away. This file is the viewer's half: probes in, violet wave bars out.
import { S } from './state';
import { SimpleMeshLayer, COORDINATE_SYSTEM } from './deck';
import { posAt } from './flight-math';
import { terrainElevAt } from './terrain';
import type { RenderTrack } from './types';
import { M_PER_LAT, mPerLng } from 'soaring-core/geo';
import { detectWave, type WaveClimb } from 'soaring-core/wavemass';
import type { Probe } from 'soaring-core/ports';

export type { WaveClimb };

const asProbe = (tr: RenderTrack): Probe => ({ rstart: tr.rstart, rend: tr.rend, at: t => posAt(tr, t) });

let cache: { tracks: RenderTrack[]; off: number; waves: WaveClimb[] } | null = null;
/** Observed wave climbs for the loaded day, memoised on the track set + geoid offset. */
export function getWaveClimbs(): WaveClimb[] {
  if (cache && cache.tracks === S.TRACKS && cache.off === S.altOffset) return cache.waves;
  const waves = detectWave(S.TRACKS.map(asProbe), terrainElevAt);
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
