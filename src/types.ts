// ============ shared types ============

/** Raw IGC sample: [lon, lat, gpsAlt, secondsOfDay]. */
export type TrackPoint = [number, number, number, number];
/** Render sample with day-relative time: [lon, lat, alt, relTime]. */
export type RelPoint = [number, number, number, number];
export type Pos3 = [number, number, number];
export type RGB = [number, number, number];

export type Mode = 'over' | 'fpv' | 'chase';
export type Trace = 'off' | 'hist' | 'histfut' | 'window';
export type TrailFx = 'basic' | 'glow' | 'contrail' | 'bloom';
export type ShadowMode = 'off' | 'nadir' | 'sun';
export type GraphMode = 'off' | 'hist' | 'histfut' | 'rolling';
export type TrafficMode = 'off' | 'radar' | 'directional';
export type Lang = 'fr' | 'en' | 'de';

/** One track parsed from an imported file (IGC/GPX/KML), before render prep. */
export interface ImportedTrack {
  name: string;          // human label (track/placemark name or glider type)
  reg: string | null;    // registration / competition id, if the format carries one
  type: number | null;   // OGN aircraft_type code if known, else null (→ glider)
  pts: TrackPoint[];
}
/** Result of parsing one imported file: its tracks + the take-off date if known. */
export interface ImportedFile { tracks: ImportedTrack[]; date: string | null; }

/** A flight track as parsed from the API (before render prep). */
export interface Track {
  label: string;
  reg: string;
  type: number;       // OGN aircraft_type code (1 = glider, 2 = tow plane, …)
  path: TrackPoint[];
  tstart: number;
  tend: number;
  maxalt: number;
  color?: RGB;
}

/** A track prepared for rendering (day-relative time, colour, span). */
export interface RenderTrack extends Track {
  color: RGB;
  rel: RelPoint[];
  rstart: number;
  rend: number;
  // OGN reception-loss intervals (day-relative seconds): consecutive beacons
  // farther apart than the gap threshold — the track is interpolated across them.
  gaps: [number, number][];
}

/** Airfield in the form the renderer consumes. */
export interface Airfield {
  name: string;
  code: string;
  lon: number;
  lat: number;
  elev: number;
  tz_off: number;
}

/** A minimal map/first-person view-state. */
export interface ViewStateLike {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  maxPitch?: number;
  position?: number[];
}

// ---- OGN FlightBook API response shapes ----
export interface FBDevice {
  address: string;
  aircraft?: string;
  aircraft_type?: number;   // OGN category code (0 unknown, 1 glider, 2 tow plane, …)
  registration?: string;
  competition?: string;
}
export interface FBFlight {
  device: number;
  start_tsp: number | null;
  stop_tsp: number | null;
  max_alt: number;
}
export interface FBAirfield {
  name: string;
  code: string;
  latlng: [number, number];
  elevation?: number;
  time_info?: { tz_offset?: string };
}
export interface FBLogbook {
  airfield?: FBAirfield;
  devices?: FBDevice[];
  flights?: FBFlight[];
}

/** Result of one logbook + IGC fetch. */
export interface FetchResult {
  af: FBAirfield;
  tzoff: number;
  tracks: Track[];
}

/** A terrarium tile decoded to RGBA + dimensions. */
export interface DecodedTile {
  rgba: Uint8Array;
  w: number;
  h: number;
}

/** The single shared mutable application state. */
export interface AppState {
  AF: Airfield | null;
  G0: number;
  G1: number;
  SPAN: number;
  TRACKS: RenderTrack[];
  ready: boolean;
  exo: number;
  // Geoid/datum offset (m) subtracted from raw GNSS (ellipsoidal) altitudes so
  // aircraft sit on the orthometric terrain instead of floating ~N metres above.
  altOffset: number;
  cur: number;
  playing: boolean;
  speed: number;
  solo: string | null;
  mode: Mode;
  // Data source: 'ogn' = FlightBook logbook/live; 'file' = locally loaded IGC
  // files (replay only, no deep-link, synthetic airfield).
  source: 'ogn' | 'file';
  subject: string | null;
  // Overview focus candidate: registration of the glider nearest the scene
  // centre. Highlighted in overview and adopted as the subject when switching
  // to cockpit/chase. Null when no glider is airborne.
  focus: string | null;
  fpvPitch: number;
  fpvFollow: boolean;
  bank: boolean;
  freeCam: { bearing: number; pitch: number };
  // Chase-cam viewpoint relative to the aircraft: az = orbit angle around it
  // (0 = directly behind), el = elevation above it (deg), dist = slant range (m).
  chase: { az: number; el: number; dist: number };
  trace: Trace;
  trailFx: TrailFx;
  // Aircraft mesh scale per view (overview/cockpit inflate to a readable marker,
  // chase draws ~real size). User-adjustable via the UI.
  modelScale: Record<Mode, number>;
  // Glide ("final glide") cone around the airfield: a transparent inverted cone
  // of slope 1/glideRatio, apex at field elevation + safetyHeight. An aircraft
  // above the surface can reach the field at the given glide ratio.
  glideCone: boolean;
  glideRatio: number;    // finesse (L/D)
  safetyHeight: number;  // arrival safety height (m) added to the apex
  coneRadiusKm: number;  // horizontal radius (km) the cone is drawn out to
  // Floating per-aircraft labels and which fields they show.
  labels: boolean;
  labelFields: { reg: boolean; alt: boolean; speed: boolean; vario: boolean; hdg: boolean };
  // Ground shadows: a blob + line under each glider and its track on the terrain
  // — to convey where aircraft are over the ground. 'nadir' = straight down
  // (position indicator), 'sun' = cast along the sun direction (realistic).
  shadowMode: ShadowMode;
  // Altitude curtain: a transparent vertical drape between each track and its
  // nadir ground projection, for a strong sense of height over the terrain.
  altCurtain: boolean;
  windowMin: number;
  spline: boolean;
  compensated: boolean;
  sound: boolean;
  trafficMode: TrafficMode;   // traffic-awareness display (focus views)
  graphMode: GraphMode;   // time-series graphs drawer mode (off = hidden)
  live: boolean;
  liveTimer: ReturnType<typeof setTimeout> | null;
  INIT: ViewStateLike;
  mapVS: ViewStateLike;
  mapTarget: ViewStateLike;
  RAW: Track[];
  CURAF: FBAirfield | null;
  CURTZ: number;
  date: string;       // loaded date (YYYY-MM-DD), used for the sun/sky computation
  COLOR: Record<string, RGB>;
  colorN: number;
  lang: Lang;
  // deck.gl TileLayer instance; kept loosely typed (deck generics are heavy).
  terrainInst: any;
}
