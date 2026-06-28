// ============ config ============
import type { RGB } from './types';

// FlightBook exposes open CORS (access-control-allow-origin: *): direct calls are possible.
export const API_BASE = 'https://flightbook.glidernet.org';
// Public source repository, linked from the info panel.
export const REPO_URL = 'https://github.com/s-celles/ogn-3d-viewer';
export const PALETTE: RGB[] = [
  [255, 140, 0], [60, 180, 255], [160, 120, 255], [120, 230, 120], [255, 90, 160],
  [250, 210, 70], [80, 220, 210], [235, 120, 90], [150, 200, 255], [200, 160, 120],
];

export const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TEXTURE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const TERRAIN_N = 96; // grid resolution per tile

// Traffic-awareness radar (focus views): show other airborne aircraft within
// `range` m of the subject, track-up. Threat levels by horizontal/vertical
// separation — alert (close) and warn (proximate).
export const TRAFFIC = {
  range: 8000,            // radar plan-view range (situational awareness)
  proximity: 3000,        // directional view shows non-threat traffic only within this
  warn: { h: 1500, v: 250 },
  alert: { h: 500, v: 100 },
};

// OGN reception loss: a gap between consecutive beacons longer than
// max(GAP_MIN, GAP_FACTOR × the track's median beacon interval) is treated as a
// reception loss (the track is interpolated across it and drawn dashed).
export const GAP_MIN = 20, GAP_FACTOR = 6;

// navigation clamps
export const MINZ = 8.5, MAXZ = 14.5, PMIN = 0, PMAX = 85;
export const clampv = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Glider attitude (display). Bank is derived from the coordinated-turn relation
// tan(roll) = V·ω / g (turn rate × ground speed). Pitch is set by AIRSPEED, not
// climb rate: a glider is always descending through the air, so unlike a powered
// aircraft it never holds a nose-up attitude in normal flight — it flies ~level
// near stall and increasingly nose-down as it speeds up. Both angles are CAPPED
// by the max below so noisy OGN tracks can't produce absurd attitudes. halfSpan /
// halfLen are the on-screen marker half-sizes in metres (a readable glyph, not
// the real 15 m wingspan).
export const GLIDER = {
  maxBankDeg: 55,   // max |roll|
  maxPitchDeg: 35,  // max |pitch|
  g: 9.81,          // gravity (m/s²)
  halfSpan: 150,    // wing marker half-span (m)
  halfLen: 110,     // fuselage marker half-length (m)
  wingPos: 0.35,    // where the wings cross the fuselage, as a fraction of halfLen
                    // ahead of the position (0 = centre, 1 = at the nose)
  dt: 3,            // ± window (s) for speed / turn-rate estimation
  pitchLevelSpeed: 19,  // m/s (~68 km/h, near stall): body attitude ≈ level
  pitchGain: 0.0085,    // rad of nose-down per m/s of speed above pitchLevelSpeed
};

// Chase cam: a FirstPersonView orbiting the subject aircraft. The viewpoint is
// spherical relative to the aircraft — az0 (orbit, 0 = behind), el0 (elevation
// above), dist0 (slant range, m) — chosen so the (scaled ~275 m) marker frames
// at roughly a third of the screen. The *Step / *Min / *Max bound the on-screen
// nudge controls. `fovy` is the vertical field of view.
export const CHASE = {
  fovy: 64,
  az0: 0, el0: 17, dist0: 400,
  azStep: 25,
  elStep: 8, elMin: -10, elMax: 80,
  distStep: 1.2, distMin: 150, distMax: 1600,
};

// Glider position marker: a heading-oriented triangle (metres). `len` is the
// nose distance ahead of the position, `back` the base behind it, `halfW` the
// half-width of the base.
export const ARROW = { len: 150, back: 65, halfW: 80 };

// Scale factor applied to the (metre-sized) 3D aircraft meshes so they read as a
// marker rather than their true ~15 m span.
export const MODEL_SCALE = 16;
