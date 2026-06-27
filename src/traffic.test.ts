import { test, expect } from 'bun:test';
import { litLeds } from './traffic-led';

// LEDs are at 15°,45°,…,345° (index i → i*30+15), so the nose (0°) sits between
// LED 0 (15°) and LED 11 (345°): there is no straight-ahead LED.
test('a head-on target lights the two front LEDs (no single front LED)', () => {
  expect(litLeds(0).sort((a, b) => a - b)).toEqual([0, 11]);
});

test('a target aligned with a LED lights exactly that one', () => {
  expect(litLeds(15)).toEqual([0]);   // on LED 0
  expect(litLeds(75)).toEqual([2]);   // on LED 2 (right side)
});

test('a target between two LEDs lights both', () => {
  expect(litLeds(90).sort((a, b) => a - b)).toEqual([2, 3]);   // between 75° and 105°
});

test('directly behind lights the two rear LEDs', () => {
  expect(litLeds(180).sort((a, b) => a - b)).toEqual([5, 6]);  // between 165° and 195°
});
