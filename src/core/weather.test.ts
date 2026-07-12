import { test, expect } from 'bun:test';
import {
  windToUV, dewpoint, lclBase, parseOpenMeteo, syntheticWx, LEVELS,
  weatherWind, weatherCloudbase, weatherConvTop, weatherStability, weatherSounding,
  envT, daySummary, type Wx,
} from './weather';

// --- a hand-built sounding: ground 200 m, 25 °C, lapse 8 K/km up to 3200 m ---
const wx = (over: Partial<Wx['hours'][0]> = {}, ref = 200): Wx => ({
  ref,
  hours: Array.from({ length: 24 }, () => ({
    cloudbase: 1500, t2m: 25, sw: 800, diff: 120, blh: 1400,
    prof: [{ alt: 210, u: 5, v: 0 }, { alt: 1210, u: 15, v: 0 }],
    tprof: [{ alt: 200, T: 25 }, { alt: 1200, T: 17 }, { alt: 3200, T: 9 }],
    ...over,
  })),
});

test('windToUV: met direction (blows FROM) → velocity vector (blows TO)', () => {
  const w = windToUV(10, 270);            // westerly → air moves east
  expect(w.u).toBeCloseTo(10, 6);
  expect(w.v).toBeCloseTo(0, 6);
  const n = windToUV(10, 0);              // northerly → air moves south
  expect(n.v).toBeCloseTo(-10, 6);
  expect(n.u).toBeCloseTo(0, 6);
});

test('dewpoint: equals T at saturation, drops as the air dries', () => {
  expect(dewpoint(20, 100)).toBeCloseTo(20, 1);
  expect(dewpoint(20, 50)).toBeLessThan(20);
  expect(dewpoint(20, 50)).toBeGreaterThan(dewpoint(20, 30));
});

test('lclBase: ~125 m per °C of spread above the field, NaN inputs → null', () => {
  const elev = 300, T = 25, RH = 50;
  const spread = T - dewpoint(T, RH);
  expect(lclBase(T, RH, elev)).toBeCloseTo(elev + 125 * spread, 6);
  expect(lclBase(20, 100, elev)).toBe(elev + 50);        // saturated → floor, not the field itself
  expect(lclBase(NaN, RH, elev)).toBeNull();
});

test('weatherWind: clamps below/above the profile and interpolates inside it', () => {
  const w = wx();
  expect(weatherWind(w, 12, 0)).toEqual([5, 0]);          // below the lowest level
  expect(weatherWind(w, 12, 9999)).toEqual([15, 0]);      // above the highest
  const mid = weatherWind(w, 12, 710)!;                   // halfway between 210 and 1210 m
  expect(mid[0]).toBeCloseTo(10, 6);
  expect(weatherWind({ ...w, hours: [{ ...w.hours[0], prof: [] }] }, 0, 500)).toBeNull();
});

test('weatherConvTop: the parcel meets the sounding where the dry adiabat crosses it', () => {
  // parcel starts at 25 + 1.5 K and cools at 9.8 K/km; the environment at 8 K/km.
  // They cross ~832 m above the ground (1.5 / (0.0098 - 0.008)).
  const top = weatherConvTop(wx(), 12);
  expect(top).toBeGreaterThan(200 + 700);
  expect(top).toBeLessThan(200 + 950);
});

test('weatherConvTop: an inversion caps the day; no sounding → boundary-layer height', () => {
  const capped = weatherConvTop(wx({ tprof: [{ alt: 200, T: 25 }, { alt: 700, T: 22 }, { alt: 900, T: 24 }] }), 12);
  expect(capped).toBeLessThan(1000);
  const noSounding = weatherConvTop(wx({ tprof: [], blh: 1400 }), 12);
  expect(noSounding).toBe(200 + 1400);                    // wx.ref + blh
  expect(weatherConvTop(wx({ tprof: [], blh: NaN }), 12)).toBeNaN();
});

test('weatherStability: N > 0 in a stable top layer, NaN when neutral/unstable', () => {
  // top layer 1200→3200 m at 4 K/km: stable (lapse < dry adiabat) → a real N
  const N = weatherStability(wx(), 12);
  expect(N).toBeGreaterThan(0.005);
  expect(N).toBeLessThan(0.03);
  // a super-adiabatic top layer has no wave
  const unstable = wx({ tprof: [{ alt: 200, T: 25 }, { alt: 1200, T: 17 }, { alt: 3200, T: -5 }] });
  expect(weatherStability(unstable, 12)).toBeNaN();
});

test('weatherCloudbase + weatherSounding expose the hour, clamped to the day', () => {
  expect(weatherCloudbase(wx(), 12)).toBe(1500);
  expect(weatherCloudbase(wx(), 999)).toBe(1500);         // hour clamped, not out of range
  const s = weatherSounding(wx(), 12)!;
  expect(s.ref).toBe(200);
  expect(s.t2m).toBe(25);
  expect(s.ceiling).toBeCloseTo(weatherConvTop(wx(), 12), 6);
  expect(weatherSounding(wx({ tprof: [] }), 12)).toBeNull();
});

test('envT interpolates the sounding and clamps outside it', () => {
  const s = weatherSounding(wx(), 12)!;
  expect(envT(s, 200)).toBeCloseTo(25, 6);
  expect(envT(s, 700)).toBeCloseTo(21, 6);                // halfway 25 → 17
  expect(envT(s, 0)).toBeCloseTo(25, 6);                  // below the sounding
  expect(envT(s, 9999)).toBeCloseTo(9, 6);                // above it
});

test('daySummary: convective depth, cumulus vs blue, open top', () => {
  const cu = daySummary(weatherSounding(wx(), 12)!);      // ceiling ~1030 m, base 1500 → dry
  expect(cu.depth).toBeGreaterThan(700);
  expect(cu.openTop).toBe(false);
  expect(cu.isCu).toBe(false);                            // ceiling below the cloudbase → blue day
  const wet = daySummary(weatherSounding(wx({ cloudbase: 800 }), 12)!);
  expect(wet.isCu).toBe(true);                            // ceiling well above the base → cumulus
});

test('syntheticWx: a sandbox atmosphere obeys its knobs (wind, shear, stability)', () => {
  const s = syntheticWx({ wind: 10, dir: 270, shear: 5, nStab: 0.011, tsurf: 20, rh: 50 }, 500);
  expect(s.ref).toBe(500);
  expect(s.hours.length).toBe(24);
  const low = weatherWind(s, 13, 510)!, high = weatherWind(s, 13, 1500)!;
  expect(low[0]).toBeCloseTo(10, 0);                      // westerly → +u (the shear already adds a little)
  expect(high[0]).toBeGreaterThan(low[0]);                // shear: stronger aloft
  expect(weatherStability(s, 13)).toBeCloseTo(0.011, 3);  // the chosen N comes back out
  expect(weatherCloudbase(s, 13)).toBeGreaterThan(500);
});

test('a payload with no pressure levels leaves an atmosphere that cannot make wave', () => {
  // This is not hypothetical. Open-Meteo's ERA5 *archive* endpoint returns null for EVERY
  // pressure level, at every date — and the viewer used to read past days from it. The result:
  // a wind profile of ONE point (the 10 m surface wind, so no shear at any altitude), a
  // temperature sounding of one point, and a stability of NaN. waveResonance needs N > N_MIN,
  // and NaN never is — so the wave field could never appear on a replayed day, silently.
  // Past days now come from the historical-forecast API, which does carry the levels.
  const j = {
    elevation: 300,
    hourly: {
      time: ['2026-06-21T12:00'],
      temperature_2m: [25], relative_humidity_2m: [50],
      wind_speed_10m: [5], wind_direction_10m: [270],
      shortwave_radiation: [800], diffuse_radiation: [120], boundary_layer_height: [1400],
      ...Object.fromEntries(LEVELS.flatMap(p => [
        [`wind_speed_${p}hPa`, [null]], [`wind_direction_${p}hPa`, [null]],
        [`geopotential_height_${p}hPa`, [null]], [`temperature_${p}hPa`, [null]],
      ])),
    },
  };
  const w = parseOpenMeteo(j, 0)!;
  const h = w.hours[0];
  expect(h.prof.length).toBe(1);                        // the surface wind, and nothing above it
  expect(h.tprof.length).toBe(1);
  // ...so the wind is the same at every altitude: no shear anywhere.
  expect(weatherWind(w, 0, 500)).toEqual(weatherWind(w, 0, 3000));
  // ...and there is no stability to speak of, hence no wave.
  expect(Number.isNaN(weatherStability(w, 0))).toBe(true);
});

test('parseOpenMeteo: builds the hours from the API payload, sorted by altitude', () => {
  const j = {
    elevation: 300,
    hourly: {
      time: ['2026-06-21T12:00'],
      temperature_2m: [25], relative_humidity_2m: [50],
      wind_speed_10m: [5], wind_direction_10m: [270],
      shortwave_radiation: [800], diffuse_radiation: [120], boundary_layer_height: [1400],
      ...Object.fromEntries(LEVELS.flatMap((p, i) => [
        [`wind_speed_${p}hPa`, [10 + i * 5]], [`wind_direction_${p}hPa`, [270]],
        [`geopotential_height_${p}hPa`, [800 + i * 700]], [`temperature_${p}hPa`, [18 - i * 6]],
      ])),
    },
  };
  const w = parseOpenMeteo(j, 0)!;
  expect(w.ref).toBe(300);
  expect(w.hours.length).toBe(1);
  const h = w.hours[0];
  expect(h.prof.map(p => p.alt)).toEqual([310, 800, 1500, 2200]);   // surface + the 3 levels, ascending
  expect(h.prof[0].u).toBeCloseTo(5, 6);                            // westerly surface wind
  expect(h.tprof[0]).toEqual({ alt: 300, T: 25 });
  expect(h.cloudbase).toBeCloseTo(lclBase(25, 50, 300)!, 6);
  expect(h.blh).toBe(1400);
  expect(weatherStability(w, 0)).toBeGreaterThan(0);
});

test('parseOpenMeteo: no elevation → the caller fallback; malformed payload → null', () => {
  const j = { hourly: { time: ['2026-06-21T12:00'], temperature_2m: [20] } };
  expect(parseOpenMeteo(j, 450)!.ref).toBe(450);
  expect(parseOpenMeteo(null, 0)).toBeNull();
  expect(parseOpenMeteo({ hourly: { time: [] } }, 0)).toBeNull();
  expect(parseOpenMeteo({}, 0)).toBeNull();
});
