// ============ the app's sky: sun/moon lights, CSS gradient, scene clock ============
// The astronomy lives in soaring-core/sky. This is what the viewer does with it: the deck
// lighting, the moon disc, the #map gradient, and the clock that says WHICH instant the
// scene is showing (replay time, or the weather sandbox's date/hour).
import { S } from './state';
import {
  solar, sunLightDir, skyColors, moonRaDec, horizonCoords, moonIllumination, days, mix, RAD, type RGB,
} from 'soaring-core/sky';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Sun params: deck LightingEffect inputs + sky-disc info (direction toward the
// sun, whether it's above the horizon, and the disc colour).
export interface SunLight {
  dir: [number, number, number]; intensity: number; color: RGB; ambient: number;
  toward: [number, number, number]; up: boolean; disc: RGB;
}
let sun: SunLight = {
  dir: [-0.6, -1, -0.5], intensity: 2.4, color: [255, 245, 225], ambient: 1.05,
  toward: [0.6, 1, 0.5], up: false, disc: [255, 240, 220],
};
export const getSun = (): SunLight => sun;

// Moon disc info: direction toward the moon (ENU), whether it's up, the
// illuminated fraction + waxing flag (for the phase shape), and the disc colour.
export interface MoonLight {
  toward: [number, number, number]; up: boolean; fraction: number; waxing: boolean; disc: RGB;
}
let moon: MoonLight = {
  toward: [0.6, 1, 0.5], up: false, fraction: 1, waxing: false, disc: [232, 234, 244],
};
export const getMoon = (): MoonLight => moon;

let lastKey = '';
// Recompute the sky colours AND the sun light from the current position / date /
// time, so the terrain shading matches the time of day. Throttled to once per
// simulated minute; called each render.
/** The instant (ms UTC) driving the sun/moon/sky and terrain lighting: the sandbox
 *  date/hour when the weather sandbox is on, else the replay clock. */
export function sceneMs(): number {
  return S.wxSim.on
    ? Date.parse((S.wxSim.date || S.date || '2024-06-21') + 'T00:00:00Z') + S.wxSim.hour * 3600 * 1000
    : Date.parse(S.date + 'T00:00:00Z') + (S.G0 + S.cur) * 1000;
}
export function updateSky(): void {
  if (!S.AF || (!S.wxSim.on && (!S.ready || !S.date))) return;
  const ms = sceneMs();
  const key = S.wxSim.on ? `sim|${S.wxSim.date}|${S.wxSim.hour}` : S.date + '|' + Math.round((S.G0 + S.cur) / 60);
  if (key === lastKey) return; lastKey = key;
  if (!Number.isFinite(ms)) return;

  const { alt, az } = solar(ms, S.AF.lat, S.AF.lon);
  const altDeg = alt / RAD;

  // Sky gradient.
  const { zenith, horizon } = skyColors(altDeg);
  const css = document.documentElement.style;
  css.setProperty('--sky-zenith', `rgb(${zenith.join(',')})`);
  css.setProperty('--sky-horizon', `rgb(${horizon.join(',')})`);

  // Sun light: direction from the sun position, intensity fading to night,
  // colour warming near the horizon, ambient dimming after dark. The light
  // elevation is capped so it stays oblique even at noon — a near-overhead sun
  // hits the bright satellite texture face-on and washes it out to white/yellow.
  const altL = Math.min(alt, 52 * RAD);
  const day = clamp((altDeg + 4) / 10, 0, 1);               // 1 above ~6°, 0 below ~-4°
  const warm = clamp((10 - altDeg) / 24, 0, 0.8);           // warmer toward the horizon
  const ca = Math.cos(alt), sa = Math.sin(alt);
  sun = {
    dir: [Math.cos(altL) * Math.sin(az), Math.cos(altL) * Math.cos(az), -Math.sin(altL)],
    intensity: 1.4 * day,
    color: mix([255, 247, 232], [255, 165, 100], warm),
    // Skylight kept high regardless of the airfield's local time: the terrain
    // base brightness must NOT collapse at night, otherwise a zoomed-out view is
    // dark even on the sunlit side of the globe. The night side is darkened
    // per-location by the day/night terminator overlay instead (see render.ts).
    ambient: 0.85,
    // Unit vector toward the sun (ENU: east, north, up) at the real elevation.
    toward: [-ca * Math.sin(az), -ca * Math.cos(az), sa],
    up: altDeg > -0.5,
    disc: mix([255, 130, 62], [255, 250, 235], clamp((altDeg + 2) / 14, 0, 1)),
  };

  // Moon: position toward the moon, illuminated fraction + waxing for the phase
  // shape, disc colour warming toward the horizon.
  const d = days(ms), mp = moonRaDec(d), mh = horizonCoords(mp.ra, mp.dec, d, S.AF.lat, S.AF.lon);
  const il = moonIllumination(d), mAltDeg = mh.alt / RAD;
  const mca = Math.cos(mh.alt), msa = Math.sin(mh.alt);
  moon = {
    toward: [-mca * Math.sin(mh.az), -mca * Math.cos(mh.az), msa],
    up: mAltDeg > -0.5,
    fraction: il.fraction,
    waxing: il.phase < 0.5,
    disc: mix([224, 188, 150], [232, 234, 244], clamp((mAltDeg + 2) / 14, 0, 1)),
  };
}
