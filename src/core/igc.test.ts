import { test, expect } from 'bun:test';
import { parseTz, parseIGC, parseIgcHeaders, pool } from './igc';

test('parseTz reads signed HHMM offsets', () => {
  expect(parseTz('+0200')).toBe(2);
  expect(parseTz('+0530')).toBeCloseTo(5.5, 6);
  // Known quirk (preserved from the original): the minutes are always added,
  // so a negative offset's minutes carry the wrong sign (-0530 → -4.5, not -5.5).
  // OGN offsets are overwhelmingly positive/whole-hour, so this rarely bites.
  expect(parseTz('-0530')).toBeCloseTo(-4.5, 6);
  expect(parseTz('UTC+0000')).toBe(0);
  expect(parseTz(undefined)).toBe(0);
  expect(parseTz('garbage')).toBe(0);
});

test('parseIGC extracts B-records as [lon,lat,alt,sod]', () => {
  // B record: time 100000, lat 4500.000N, lon 00500.000E, A, pressAlt 00000, gpsAlt 01234
  const line = 'B' + '100000' + '4500000N' + '00500000E' + 'A' + '00000' + '01234';
  const pts = parseIGC(line + '\n');
  expect(pts.length).toBe(1);
  const [lon, lat, alt, sod] = pts[0];
  expect(lon).toBeCloseTo(5, 6);
  expect(lat).toBeCloseTo(45, 6);
  expect(alt).toBe(1234);
  expect(sod).toBe(10 * 3600); // 10:00:00
});

test('parseIGC handles S/W hemispheres and skips non-B lines', () => {
  const header = 'HFDTE010100';
  const b = 'B' + '000030' + '0130500S' + '01230500W' + 'A' + '00000' + '00100';
  const pts = parseIGC(header + '\n' + b + '\n');
  expect(pts.length).toBe(1);
  expect(pts[0][0]).toBeLessThan(0); // west → negative lon
  expect(pts[0][1]).toBeLessThan(0); // south → negative lat
  expect(pts[0][3]).toBe(30);        // 00:00:30
});

test('pool runs all items with bounded concurrency', async () => {
  const seen: number[] = [];
  let active = 0, maxActive = 0;
  await pool([1, 2, 3, 4, 5], 2, async (n) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 5));
    seen.push(n); active--;
  });
  expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  expect(maxActive).toBeLessThanOrEqual(2);
});

test('parseIGC falls back to pressure altitude when GPS alt is 0', () => {
  // GPS alt 00000 (no fix) → use pressure altitude 01100
  const noFix = 'B' + '100000' + '4500000N' + '00500000E' + 'A' + '01100' + '00000';
  expect(parseIGC(noFix + '\n')[0][2]).toBe(1100);
  // GPS present → GPS wins over pressure
  const withFix = 'B' + '100000' + '4500000N' + '00500000E' + 'A' + '01100' + '01234';
  expect(parseIGC(withFix + '\n')[0][2]).toBe(1234);
});

test('parseIgcHeaders reads date, ids and glider type (both header dialects)', () => {
  const igc = [
    'HFDTE150624',
    'HFGIDGLIDERID:F-CGKK',
    'HFCIDCOMPETITIONID:7T',
    'HFGTYGLIDERTYPE:ASK 21',
    'HFPLTPILOTINCHARGE:Jane Doe',
  ].join('\n');
  const h = parseIgcHeaders(igc);
  expect(h.date).toBe('2024-06-15');
  expect(h.reg).toBe('F-CGKK');
  expect(h.comp).toBe('7T');
  expect(h.gliderType).toBe('ASK 21');
  expect(h.pilot).toBe('Jane Doe');
  // newer HFDTEDATE dialect
  expect(parseIgcHeaders('HFDTEDATE:010125,01').date).toBe('2025-01-01');
});
