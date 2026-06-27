import { test, expect } from 'bun:test';
import { sunAltitudeDeg, skyColors } from './sky';

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

test('skyColors: blue by day, warm near the horizon, dark at night', () => {
  const day = skyColors(50).zenith;       // high sun → blue (B > R)
  expect(day[2]).toBeGreaterThan(day[0]);
  const set = skyColors(-1).horizon;      // sunset horizon → warm (R > B)
  expect(set[0]).toBeGreaterThan(set[2]);
  const night = skyColors(-30).zenith;    // night → dark
  expect(Math.max(...night)).toBeLessThan(40);
});
