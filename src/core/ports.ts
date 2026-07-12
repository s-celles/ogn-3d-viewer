// ============ ports: what the kernel needs from the world, as functions ============
// The kernel computes; it never fetches, caches or renders. Everything it needs from
// the outside comes in as a plain function, so the same code serves a viewer reading
// CDN tiles and a flight computer reading an offline data pack.

/** Ground elevation (m AMSL) at a lon/lat. Null = *unknown* (not loaded), never a
 *  fake zero: the caller must be able to tell "sea level" from "no data yet". */
export type ElevSampler = (lon: number, lat: number) => number | null;
