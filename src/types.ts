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
export type Lang = 'fr' | 'en' | 'de' | 'es' | 'it';

/** Developer-mode options (enabled with ?dev=1). Tuners only take effect while
 *  `on` is true, so normal users are unaffected. */
export interface DevOpts {
  on: boolean;
  wireframe: boolean;   // draw the terrain mesh as wireframe
  noTexture: boolean;   // bare shaded relief (no imagery)
  skirts: boolean;      // draw the crack-hiding tile skirts
  tileBounds: boolean;  // outline each tile + label its z/x/y
  fps: boolean;         // FPS / frame-time overlay
  counters: boolean;    // live cache counters overlay
  maxRequests: number;  // terrain tile concurrency
  gridN: number;        // terrain mesh grid resolution per tile
  farKm: number;        // first-person/chase far plane (km)
  deckCache: number;    // deck decoded-tile LRU size
}

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
  country?: string;   // ISO country from the logbook (authoritative — beats the ICAO-prefix guess)
}

/** A minimal map/first-person view-state. */
export interface ViewStateLike {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  minZoom?: number;
  maxZoom?: number;
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
  country?: string;
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
  image?: ImageBitmap | null;   // pre-fetched imagery, so the tile shows textured (no white flash)
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
  groundZoom: number;   // imagery/terrain detail ceiling (max tile zoom)
  cacheScale: number;   // multiplier on the device-default cache sizes
  dev: DevOpts;
  // Geoid/datum offset (m) subtracted from raw GNSS (ellipsoidal) altitudes so
  // aircraft sit on the orthometric terrain instead of floating ~N metres above.
  altOffset: number;
  cur: number;
  playing: boolean;
  speed: number;
  dir: 1 | -1;   // playback direction (forward / reverse)
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
  // Manual overview focus: when set (via J/K or the HUD ◀/▶), it pins `focus` to
  // this glider instead of the nearest-to-centre one, until the user pans.
  focusLock: string | null;
  fpvPitch: number;
  fpvFollow: boolean;
  bank: boolean;
  freeCam: { bearing: number; pitch: number };
  // Free first-person observer (teleport): when set, the cockpit view is anchored here
  // (lon/lat, altitude m MSL) with this bearing/pitch instead of following a glider.
  obs: { lon: number; lat: number; alt: number; bearing: number; pitch: number } | null;
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
  // Show the cartographic attribution overlay (imagery/terrain credit) on the
  // map. Default on; kept visible in the info panel regardless.
  showAttribution: boolean;
  // Key into BASEMAPS: which base map is draped over the terrain.
  basemap: string;
  // Use the finer IGN RGE ALTI DEM over France (falls back to Terrarium elsewhere).
  ignDem: boolean;
  // Named summits (OSM) + imported waypoints, shown as poles + labels.
  showPeaks: boolean;
  peakDensity: number;   // 0..1 — how many summit labels to show
  // Mark the wind-workable mountain passes (saddles the wind blows through) around the view.
  cols: boolean;
  // Procedural (illustrative, fictional) buildings over the OSM urban areas.
  buildings: boolean;
  // Inset 2D minimap (flat tiles + track + heading) shown in the immersive views.
  minimap: boolean;
  // Show the HUD (focused glider telemetry) in the overview too (opt-in).
  overviewHud: boolean;
  // Only show/cycle gliders airborne at the current time (opt-in).
  activeOnly: boolean;
  // Anonymous mode: hide real registrations behind neutral tags (G1, G2, …) everywhere they
  // show — for screenshots. Internal identity (subject, solo, deep links) keeps the real reg.
  anon: boolean;
  // Show the reconstructed air mass (thermal columns + cumulus) from the tracks.
  airMass: boolean;
  // Show the estimated lift-potential field (thermal + slope lift, physics).
  thermalPot: boolean;
  // Lift-potential components (same order as LIFT_COMPS in lift.ts). liftOn enables
  // each one (a checkbox → whether it is a vertex of the mixer); liftMix is the blend
  // weight per component, set by the simplex "mixer" and normalised to Σ=1 over the
  // enabled ones, scaling that component's opacity. Extensible: a wave term adds an
  // entry to both and a vertex to the mixer.
  liftOn: boolean[];
  liftMix: number[];
  // Calibrate the thermal magnitude to the day's observed climbs (opt-in): a single
  // global day-scale factor. Off by default — a global factor can dim favourable
  // slopes that simply had no traffic.
  liftCalibrate: boolean;
  // Diurnal ground heat storage strength (0..1): how much surfaces store midday heat and
  // release it in the late afternoon, weighted by each land-cover's thermal inertia. 0 = off.
  heatStore: number;
  // Weather sandbox: when `on`, a synthetic atmosphere replaces the fetched weather
  // (uniform wind + a chosen stability), so wave/thermal/etc. can be explored "what-if".
  // `date`/`hour` drive the sun (season + time of day) in sandbox mode, independent of
  // any loaded flights.
  wxSim: { on: boolean; wind: number; dir: number; shear: number; nStab: number; tsurf: number; rh: number; date: string; hour: number };
  // Active glider polar (for the netto vario); imported from an XCSoar/LK8000 .plr.
  polar: import('./polar').Polar;
  // Netto vario readout in the HUD: 'off' (default), 'netto' (air-mass Vz), or 'super'
  // (also the super/relative netto — the climb achievable by circling in this air).
  nettoMode: 'off' | 'netto' | 'super';
  // Wind-flow representation: 'off'; 2D draped variants — 'drapeVec' (arrows),
  // 'drapeCol' (speed colours), 'drapeBoth', 'barbs' (station wind barbs); or 3D
  // profile views — 'layers' (arrows at altitude bands), 'rings', 'hodograph'.
  windMode: 'off' | 'drapeVec' | 'drapeCol' | 'drapeBoth' | 'barbs' | 'isotachs' | 'layers' | 'rings' | 'hodograph';
  // Reference for the parenthetical height next to the altitude:
  // 'af' = above the departure aerodrome (QFE analogue), 'ground' = AGL,
  // 'off' = altitude only (no height shown).
  heightRef: 'af' | 'ground' | 'off';
  // Show the clock in UTC instead of the airfield's local time.
  clockUTC: boolean;
  // 12-hour clock (AM/PM) instead of 24-hour.
  clock12: boolean;
  // Image-export format for the 📷 button (PNG lossless / WebP smaller).
  exportFmt: 'png' | 'webp';
  // Follow the browser locale for the UI language (the "Auto" language choice).
  langAuto: boolean;
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
