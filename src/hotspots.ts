// ============ live "hot spots": where gliders are flying right now ============
// The OGN live map (live.glidernet.org) serves every marker in a bbox as XML;
// it sends CORS headers reflecting the origin, so we can query it from the
// browser. We tile the whole world, keep the airborne GLIDERS (type 1), cluster
// them into a coarse grid and rank the cells — a live picture of where soaring is
// happening. Only aggregates are used (counts per area), never individual craft.
//
// Marker fields: lat,lon,cn,reg,alt,time,ddf,track,speed,vz,TYPE,RECEIVER,fid,crc

export interface HotZone { lat: number; lon: number; count: number; label: string; }
export interface HotResult { zones: HotZone[]; at: number; }

// Minimum delay between two live scans of the whole world — the OGN network is
// shared, so we throttle hard and reuse the last result within this window.
export const HOT_MIN_INTERVAL = 900_000;   // 15 min

let cache: HotResult | null = null;
export function hotCache(): HotResult | null { return cache; }
export function hotFresh(): boolean { return !!cache && Date.now() - cache.at < HOT_MIN_INTERVAL; }

const OGN = 'https://live.glidernet.org/lxml.php';
// World tiles as [latMax, latMin, lonMax, lonMin] (the endpoint's b,c,d,e).
const TILES: [number, number, number, number][] = [
  [80, 15, -90, -180], [80, 15, 0, -90], [80, 15, 90, 0], [80, 15, 180, 90],
  [15, -60, -90, -180], [15, -60, 0, -90], [15, -60, 90, 0], [15, -60, 180, 90],
];
const GRID = 0.3;   // ~33 km cells

export async function fetchHotZones(topN = 30, force = false): Promise<HotResult> {
  if (!force && hotFresh()) return cache!;   // reuse the recent scan unless a forced refresh is asked
  const texts = await Promise.all(TILES.map(([b, c, d, e]) =>
    fetch(`${OGN}?a=full&b=${b}&c=${c}&d=${d}&e=${e}`).then(r => r.text()).catch(() => '')));
  interface Cell { lat: number; lon: number; n: number; rec: Map<string, number>; }
  const cells = new Map<string, Cell>(), seen = new Set<string>();
  for (const txt of texts) {
    for (const m of txt.matchAll(/<m a="([^"]+)"/g)) {
      const t = m[1].split(',');
      if (t[10] !== '1') continue;                       // gliders only
      if (t[13] && seen.has(t[13])) continue;            // dedup across tile overlaps
      if (t[13]) seen.add(t[13]);
      const lat = +t[0], lon = +t[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 90) continue;
      const key = Math.round(lat / GRID) + '|' + Math.round(lon / GRID);
      let z = cells.get(key);
      if (!z) { z = { lat: 0, lon: 0, n: 0, rec: new Map() }; cells.set(key, z); }
      z.lat += lat; z.lon += lon; z.n++;
      const r = t[11] || ''; if (r) z.rec.set(r, (z.rec.get(r) || 0) + 1);
    }
  }
  const zones = [...cells.values()]
    .map(z => ({ lat: z.lat / z.n, lon: z.lon / z.n, count: z.n, label: [...z.rec.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '' }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  cache = { zones, at: Date.now() };
  return cache;
}
