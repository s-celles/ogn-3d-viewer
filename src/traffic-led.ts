// ============ directional traffic indicator: LED geometry (pure) ============
// 12 horizontal direction LEDs at 15°, 45°, … 345° (index i → i*30+15), so the
// nose (0°) sits BETWEEN LED 0 and LED 11 — there is no straight-ahead LED, and
// a head-on target lights the two front LEDs. Kept DOM-free so it is unit-tested.
export const LED_OFFSET = 15, LED_STEP = 30, LIT_DEAD = 16;   // degrees
export const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Which LEDs light for a bearing (deg, 0 = ahead): the nearest, plus any other
// within LIT_DEAD of that nearest distance (so a between-LEDs bearing lights two).
export function litLeds(bearingDeg: number): number[] {
  const bd = (bearingDeg % 360 + 360) % 360;
  let i1 = 0, d1 = 1e9;
  for (let i = 0; i < 12; i++) { const d = angDiff(bd, i * LED_STEP + LED_OFFSET); if (d < d1) { d1 = d; i1 = i; } }
  const out = [i1];
  for (let i = 0; i < 12; i++) if (i !== i1 && angDiff(bd, i * LED_STEP + LED_OFFSET) - d1 < LIT_DEAD) out.push(i);
  return out;
}
