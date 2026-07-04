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
const OVERPASS = 'https://overpass-api.de/api/interpreter';
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
    const res = await fetch(OVERPASS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json() as { elements?: Array<{ lat: number; lon: number; tags?: Record<string, string> }> };
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

// ---- user waypoints from a SeeYou .cup file (persisted) ----------------------
const WKEY = 'ogn.waypoints';
let waypoints: Poi[] = [];
try { waypoints = JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch { /* ignore */ }
export function getWaypoints(): Poi[] { return waypoints; }
export function clearWaypoints(): void { waypoints = []; try { localStorage.removeItem(WKEY); } catch { /* ignore */ } }

// SeeYou CUP latitude "DDMM.mmmN/S", longitude "DDDMM.mmmE/W".
function cupCoord(raw: string): number {
  const m = raw.trim().match(/^(\d{2,3})(\d{2}\.\d+)([NSEW])$/i); if (!m) return NaN;
  let v = parseInt(m[1], 10) + parseFloat(m[2]) / 60;
  const h = m[3].toUpperCase(); if (h === 'S' || h === 'W') v = -v;
  return v;
}
function cupElev(raw: string): number {
  const m = raw.trim().replace(/^"|"$/g, '').match(/^([\d.]+)\s*(m|ft)?$/i); if (!m) return 0;
  const v = parseFloat(m[1]); return /ft/i.test(m[2] || '') ? v * 0.3048 : v;
}
// SeeYou `style` column → coarse marker category. 2/4/5 airfields (grass/gliding/
// solid), 3 outlanding field, 6/7 pass/summit, 8/11/15 mast/tower/plant (obstacles);
// everything else (1 waypoint, 9/10 VOR/NDB, 16 castle, 17-21 turnpoints…) is a landmark.
function cupCat(raw: string): PoiCat {
  switch (parseInt(raw.trim(), 10)) {
    case 2: case 4: case 5: return 'airfield';
    case 3: return 'outland';
    case 6: case 7: return 'summit';
    case 8: case 11: case 15: return 'obstacle';
    default: return 'landmark';
  }
}
/** Parse a SeeYou .cup file → append its waypoints. Returns how many were added. */
export function importCup(text: string): number {
  let added = 0;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || /^name\s*,/i.test(l) || l.startsWith('-----')) continue;   // blank / header / task section
    const cells: string[] = []; let cur = '', q = false;                 // CSV split honouring quotes
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur);
    if (cells.length < 6) continue;
    const name = cells[0].replace(/^"|"$/g, '').trim();
    const lat = cupCoord(cells[3]), lon = cupCoord(cells[4]), ele = cupElev(cells[5]);
    if (name && Number.isFinite(lat) && Number.isFinite(lon)) { waypoints.push({ lon, lat, ele, name, kind: 'wp', cat: cupCat(cells[6] || '') }); added++; }
  }
  if (added) { try { localStorage.setItem(WKEY, JSON.stringify(waypoints)); } catch { /* quota */ } }
  return added;
}
