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

// navigation clamps
export const MINZ = 8.5, MAXZ = 14.5, PMIN = 0, PMAX = 85;
export const clampv = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Glider attitude (display). Bank is derived from the coordinated-turn relation
// tan(roll) = V·ω / g (turn rate × ground speed), pitch from the flight-path
// angle (vario / ground speed). Both are CAPPED by the max angles below so noisy
// OGN tracks can't produce absurd attitudes. halfSpan / halfLen are the on-screen
// marker half-sizes in metres (a readable glyph, not the real 15 m wingspan).
export const GLIDER = {
  maxBankDeg: 55,   // max |roll|
  maxPitchDeg: 35,  // max |pitch|
  g: 9.81,          // gravity (m/s²)
  halfSpan: 150,    // wing marker half-span (m)
  halfLen: 110,     // fuselage marker half-length (m)
  wingPos: 0.35,    // where the wings cross the fuselage, as a fraction of halfLen
                    // ahead of the position (0 = centre, 1 = at the nose)
  dt: 3,            // ± window (s) for speed / turn-rate estimation
};

// Chase cam: a MapView that follows the subject glider from behind and above.
// `lead` >1 shifts the framing so the glider sits slightly below screen centre
// (looking ahead), <1 raises it; 1 centres it exactly.
export const CHASE = { zoom: 13.6, pitch: 58, lead: 1.12 };

// Glider position marker: a heading-oriented triangle (metres). `len` is the
// nose distance ahead of the position, `back` the base behind it, `halfW` the
// half-width of the base.
export const ARROW = { len: 150, back: 65, halfW: 80 };

// Scale factor applied to the (metre-sized) 3D aircraft meshes so they read as a
// marker rather than their true ~15 m span.
export const MODEL_SCALE = 16;
