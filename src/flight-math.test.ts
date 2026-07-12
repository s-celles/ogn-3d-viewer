// The flight maths itself is now tested in core/flight.test.ts, on synthetic paths with no app
// state at all. What is left here is the app's half — the things that only mean anything once
// there is a clock, a live feed and a loaded day.
import { test, expect } from 'bun:test';
import { presence, buildRel } from './flight-math';
import { LIVE } from './config';
import { S } from './state';
import type { RenderTrack, TrackPoint, RelPoint } from './types';

// Build a synthetic RenderTrack from [lon,lat,alt,relTime] points.
function mkTrack(rel: RelPoint[], type = 1): RenderTrack {
  return { label: 'x', reg: 'R', type, maxalt: 0, color: [0, 0, 0], path: [], tstart: rel[0][3], tend: rel[rel.length - 1][3], rel, rstart: rel[0][3], rend: rel[rel.length - 1][3], gaps: [] };
}

test('buildRel applies the day\'s geoid correction from app state', () => {
  // The correction itself is core's; what is app is knowing WHICH correction today needs.
  const raw: TrackPoint[] = [[6, 45, 1050, 36000]];
  const prev = S.altOffset;
  S.altOffset = 50;
  try {
    expect(buildRel(raw, 36000, false)[0][2]).toBe(1000);   // ellipsoidal → orthometric
  } finally { S.altOffset = prev; }
});

test('presence: replay shows airborne at the cursor, never offline', () => {
  const tr = mkTrack([[0, 45, 0, 0], [0.001, 45, 100, 50], [0.002, 45, 200, 100]]);
  S.live = false;
  S.cur = 50;  expect(presence(tr)).toEqual({ time: 50, offline: false });
  S.cur = 150; expect(presence(tr)).toBeNull();   // past the last beacon
  S.cur = -10; expect(presence(tr)).toBeNull();   // before take-off
});

test('presence: live freezes at the last fix, online → offline → hidden by age', () => {
  const tr = mkTrack([[0, 45, 0, 0], [0.001, 45, 100, 50], [0.002, 45, 200, 100]]); // rend = 100
  S.live = true;
  try {
    S.cur = 50;                              // within the track
    expect(presence(tr)).toEqual({ time: 50, offline: false });
    S.cur = 100 + LIVE.onlineMaxAge - 1;     // just-stale fix → online, frozen at rend
    expect(presence(tr)).toEqual({ time: 100, offline: false });
    S.cur = 100 + LIVE.onlineMaxAge + 1;     // older fix → offline, still frozen at rend
    expect(presence(tr)).toEqual({ time: 100, offline: true });
    S.cur = 100 + LIVE.offlineMaxAge + 1;    // too old → hidden (landed / gone)
    expect(presence(tr)).toBeNull();
  } finally {
    S.live = false; S.cur = 0;               // restore shared state for other tests
  }
});
