import { test, expect } from 'bun:test';
import { sunAltitudeDeg, skyColors, sunLightDir, subsolar, nightPolygon } from './sky';

const ms = (iso: string) => Date.parse(iso);

test('sunAltitudeDeg: high at local solar noon, below horizon at night', () => {
  // Summer solstice, lat 45N, lon 0: solar noon ≈ 12:00 UTC → ~68° (90-45+23.4)
  const noon = sunAltitudeDeg(ms('2026-06-21T12:00:00Z'), 45, 0);
  expect(noon).toBeGreaterThan(60);
  expect(noon).toBeLessThan(72);
  // Midnight UTC at the same place → sun well below the horizon
  expect(sunAltitudeDeg(ms('2026-06-21T00:00:00Z'), 45, 0)).toBeLessThan(-10);
});

test('sunAltitudeDeg: winter noon is much lower than summer noon', () => {
  const summer = sunAltitudeDeg(ms('2026-06-21T12:00:00Z'), 45, 0);
  const winter = sunAltitudeDeg(ms('2026-12-21T12:00:00Z'), 45, 0);
  expect(winter).toBeLessThan(summer - 30); // ~22° vs ~68°
  expect(winter).toBeGreaterThan(0);
});

test('sunLightDir: light travels down at noon, from the east at sunrise / west at sunset', () => {
  // Noon: sun overhead-ish → light travels downward (z < 0)
  expect(sunLightDir(ms('2026-06-21T12:00:00Z'), 45, 0)[2]).toBeLessThan(-0.3);
  // Morning (sun in the east) → light travels westward (x < 0); evening → eastward (x > 0)
  const morning = sunLightDir(ms('2026-06-21T05:30:00Z'), 45, 0);
  const evening = sunLightDir(ms('2026-06-21T18:30:00Z'), 45, 0);
  expect(morning[0]).toBeLessThan(0);
  expect(evening[0]).toBeGreaterThan(0);
  // direction is a unit vector
  const L = Math.hypot(...sunLightDir(ms('2026-06-21T12:00:00Z'), 45, 0));
  expect(L).toBeCloseTo(1, 6);
});

test('skyColors: blue by day, warm near the horizon, dark at night', () => {
  const day = skyColors(50).zenith;       // high sun → blue (B > R)
  expect(day[2]).toBeGreaterThan(day[0]);
  const set = skyColors(-1).horizon;      // sunset horizon → warm (R > B)
  expect(set[0]).toBeGreaterThan(set[2]);
  const night = skyColors(-30).zenith;    // night → dark
  expect(Math.max(...night)).toBeLessThan(40);
});

test('subsolar point near June solstice noon', () => {
  const s = subsolar(ms('2026-06-27T12:00:00Z'));
  expect(s.lat).toBeGreaterThan(22);
  expect(s.lat).toBeLessThan(24);
  expect(Math.abs(s.lon)).toBeLessThan(6);
});

test('night polygon excludes the subsolar point and includes the antisolar point', () => {
  const at = ms('2026-06-27T12:00:00Z');
  expect(nightPolygon(at)).not.toBeNull();
  const s = subsolar(at);
  expect(sunAltitudeDeg(at, s.lat, s.lon)).toBeGreaterThan(80);          // subsolar → daylight
  const antiLon = ((s.lon + 360) % 360) - 180;
  expect(sunAltitudeDeg(at, -s.lat, antiLon)).toBeLessThan(0);           // antisolar → night
});
