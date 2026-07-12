// ============ core domain types ============
// The soaring domain, free of any app/rendering concern — so a flight computer
// (no deck.gl, no DOM) can consume the same core as the 3D viewer.

/** Raw IGC sample: [lon, lat, gpsAlt, secondsOfDay]. */
export type TrackPoint = [number, number, number, number];

/** A track sample on the day's clock: [lon, lat, alt (m), seconds since the day's origin]. */
export type RelPoint = [number, number, number, number];
/** A point in space: [lon, lat, alt (m)]. */
export type Pos3 = [number, number, number];

/** One track parsed from an imported file (IGC/GPX/KML), before render prep. */
export interface ImportedTrack {
  name: string;          // human label (track/placemark name or glider type)
  reg: string | null;    // registration / competition id, if the format carries one
  type: number | null;   // OGN aircraft_type code if known, else null (→ glider)
  pts: TrackPoint[];
}

/** Result of parsing one imported file: its tracks + the take-off date if known. */
export interface ImportedFile { tracks: ImportedTrack[]; date: string | null; }
