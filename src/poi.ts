// ============ points of interest: OSM summits + imported .cup waypoints ============
// Named summits come from OpenStreetMap (natural=peak, with name + ele) via the
// public Overpass API — open, keyless, CORS-enabled. Results are cached by a
// rounded bounding box (in memory + localStorage) so panning/reloading never
// re-queries Overpass for an area we already have. Waypoints come from a
// user-imported SeeYou .cup file and are persisted.

// Coarse category driving the marker's glyph + colour. OSM summits are always
// 'summit'; .cup waypoints are mapped from their SeeYou `style` column.
export type PoiCat = 'summit' | 'airfield' | 'outland' | 'obstacle' | 'landmark';
export interface Poi { lon: number; lat: number; ele: number; name: string; kind: 'peak' | 'wp'; cat: PoiCat }

// ---- OSM peaks via Overpass, cached by rounded bbox --------------------------
import { overpass } from './overpass';
const CKEY = 'ogn.peaks';
const cache = new Map<string, Poi[]>();
// Only non-empty results are ever cached, so a stale/empty entry (from a past
// bug or a transient failure) is ignored here and simply re-fetched — no key
// versioning needed.
try { const o = JSON.parse(localStorage.getItem(CKEY) || '{}'); for (const k in o) if (Array.isArray(o[k]) && o[k].length) cache.set(k, o[k]); } catch { /* ignore */ }
function persist(): void {
  try { const o: Record<string, Poi[]> = {}; let n = 0; for (const [k, v] of cache) { if (n++ >= 24) break; o[k] = v; } localStorage.setItem(CKEY, JSON.stringify(o)); } catch { /* quota */ }
}

let peaks: Poi[] = [];
export function getPeaks(): Poi[] { return peaks; }

let pending = '';   // key currently in flight (dedupe concurrent loads)
/** Fetch the named summits covering a flight's area (clamped + rounded + cached). */
export async function loadPeaks(west: number, south: number, east: number, north: number): Promise<void> {
  // Expand the flight bounds by a margin (so a local flight still gets an area),
  // cap the half-span (a 1000 km XC won't query half a country of peaks), and
  // round to a 0.25° grid for a stable cache key.
  const cx = (west + east) / 2, cy = (south + north) / 2, MARGIN = 0.25, HS = 1.1;
  const hx = Math.min(HS, (east - west) / 2 + MARGIN), hy = Math.min(HS, (north - south) / 2 + MARGIN);
  const w = cx - hx, e = cx + hx, s = cy - hy, n = cy + hy;
  const r = (v: number) => (Math.round(v * 4) / 4).toFixed(2);
  const key = [r(w), r(s), r(e), r(n)].join(',');
  const hit = cache.get(key); if (hit) { peaks = hit; return; }
  if (pending === key) return; pending = key;
  const q = `[out:json][timeout:25];node["natural"="peak"](${r(s)},${r(w)},${r(n)},${r(e)});out;`;
  try {
    const data = await overpass(q) as { elements?: Array<{ lat: number; lon: number; tags?: Record<string, string> }> } | null;
    if (!data) { if (pending === key) pending = ''; return; }
    const list: Poi[] = [];
    for (const el of (data.elements || [])) {
      const t = el.tags || {}, ele = parseFloat(String(t.ele));
      if (t.name && Number.isFinite(ele) && el.lat != null) list.push({ lon: el.lon, lat: el.lat, ele, name: t.name, kind: 'peak', cat: 'summit' });
    }
    list.sort((a, b) => b.ele - a.ele);   // highest first (density = keep the top N)
    if (list.length) { cache.set(key, list); persist(); }   // never cache an empty result
    peaks = list;
  } catch { /* offline / rate-limited → keep what we had */ }
  finally { if (pending === key) pending = ''; }
}

// ---- nearby aerodromes (OSM), to resolve a hot-spot centroid to a real airfield -
export interface Aerodrome { icao: string; name: string; lat: number; lon: number; }
const adCache = new Map<string, Aerodrome[]>();
/** Aerodromes near [lat,lon] (within ~25 km) from OpenStreetMap, nearest first —
 *  candidates whose code the caller then resolves + verifies against FlightBook. */
export async function nearbyAerodromes(lat: number, lon: number): Promise<Aerodrome[]> {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  const hit = adCache.get(key); if (hit) return hit;
  const q = `[out:json][timeout:25];nwr["aeroway"="aerodrome"](around:25000,${lat},${lon});out center tags;`;
  try {
    const data = await overpass(q) as { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> } | null;
    if (!data) return [];
    const cs = Math.cos(lat * Math.PI / 180);
    const list: Array<Aerodrome & { d: number }> = [];
    for (const el of (data.elements || [])) {
      const t = el.tags || {}, alat = el.lat ?? el.center?.lat, alon = el.lon ?? el.center?.lon;
      if (alat == null || alon == null) continue;
      const icao = (t.icao || '').toUpperCase().match(/^[A-Z]{4}$/) ? t.icao!.toUpperCase() : '';
      list.push({ icao, name: t.name || '', lat: alat, lon: alon, d: Math.hypot(alat - lat, (alon - lon) * cs) });
    }
    list.sort((a, b) => a.d - b.d);
    const out = list.slice(0, 6).map(({ d, ...a }) => a);   // eslint-disable-line @typescript-eslint/no-unused-vars
    if (out.length) adCache.set(key, out);   // cache only non-empty (a rate-limited miss retries)
    return out;
  } catch { return []; }
}

// ---- user waypoints from a SeeYou .cup file (persisted) ----------------------
const WKEY = 'ogn.waypoints';
let waypoints: Poi[] = [];
try { waypoints = JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch { /* ignore */ }
export function getWaypoints(): Poi[] { return waypoints; }
export function clearWaypoints(): void { waypoints = []; try { localStorage.removeItem(WKEY); } catch { /* ignore */ } }

// ---- waypoint files: the PARSING is the kernel's, the display is ours ----------
// The .cup reader that used to live here has moved to `soaring-core/poi` (v0.4.0), which also
// speaks WinPilot .dat/.wpt and keeps the SeeYou `style` column at full granularity. It moved
// because a sibling app needed exactly the same thing and was about to write a third copy —
// C4bis, the same lesson the vario sound law taught.
//
// One real bug went with it, and it is worth naming rather than quietly deleting: the old
// `cupElev` answered an unreadable elevation with **zero**. Here that only mis-draws a 3D
// pole. In a FLIGHT COMPUTER, that same zero is a final glide computed to a field 1650 m
// lower than it really is. The kernel now answers `null`, and every caller has to decide what
// to do with not-knowing — which is the point.
//
// What THIS app decides: a viewer draws places. So a waypoint whose elevation the file did not
// give is still drawn, its pole planted at 0 m — a DISPLAY fallback, chosen here, in the open,
// and safe precisely because nothing in this app computes a glide.

import { parsePoiFile, type Poi as CorePoi, type PoiCat as CoreCat } from 'soaring-core/poi';

// The kernel distinguishes grass / gliding / solid airfields; this map's glyphs do not, so we
// fold them here — a DISPLAY decision, made in the display layer, over a distinction the
// kernel preserved rather than destroyed.
function coarse(c: CoreCat): PoiCat {
  switch (c) {
    case 'airfield-solid': case 'airfield-grass': case 'airfield-gliding': return 'airfield';
    case 'outlanding': return 'outland';
    case 'summit': case 'pass': return 'summit';
    case 'obstacle': return 'obstacle';
    default: return 'landmark';
  }
}

/** Import a waypoint file (SeeYou .cup, WinPilot .dat/.wpt — sniffed) → append its places.
 *  Returns how many were added. */
export function importCup(text: string): number {
  const { pois } = parsePoiFile(text);
  for (const p of pois as CorePoi[]) {
    waypoints.push({
      lon: p.lon, lat: p.lat,
      ele: p.elevM ?? 0,          // the display fallback — see the note above
      name: p.name, kind: 'wp', cat: coarse(p.cat),
    });
  }
  if (pois.length) { try { localStorage.setItem(WKEY, JSON.stringify(waypoints)); } catch { /* quota */ } }
  return pois.length;
}
