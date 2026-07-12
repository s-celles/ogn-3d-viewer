// ============ ports: what the kernel needs from the world, as functions ============
// The kernel computes; it never fetches, caches or renders. Everything it needs from
// the outside comes in as a plain function, so the same code serves a viewer reading
// CDN tiles and a flight computer reading an offline data pack.

/** Ground elevation (m AMSL) at a lon/lat. Null = *unknown* (not loaded), never a
 *  fake zero: the caller must be able to tell "sea level" from "no data yet". */
export type ElevSampler = (lon: number, lat: number) => number | null;

/** A glider, seen as an atmospheric probe: a track we can ask "where were you at time t?".
 *  Where one circles while gaining height, the air is rising — that is the only thing the
 *  air-mass detectors need from a track, and it keeps them free of the app's track format. */
export interface Probe {
  rstart: number;                                        // first / last valid time (relative seconds)
  rend: number;
  at: (t: number) => readonly [number, number, number];  // lon, lat, altitude (m)
}
