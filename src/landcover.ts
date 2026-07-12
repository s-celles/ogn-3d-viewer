// ============ OSM land-cover for the thermal model (albedo + sensible fraction) =====
// Overpass landuse/natural polygons for the view, offline-first, cached by bbox, then
// rasterised onto the thermal grid so the potential varies over flat terrain too (dry
// fields / bare ground pump; forest, water barely). Typical albedo + sensible-heat
// fraction per class. Ways + relation multipolygons (outer rings; inner holes ignored).
// Rough and illustrative — see the docs.
import { overpass, overpassDown } from './overpass';
import { M_PER_LAT, mPerLng } from 'soaring-core/geo';

// alb = albedo, sens = sensible-heat fraction, iner = thermal inertia/admittance (0..1:
// high = stores heat then releases it late, e.g. rock/urban; low = heats & cools fast,
// e.g. dry fields), pri = priority on overlap.
export interface LCClass { alb: number; sens: number; iner: number; pri: number }
const CLS: Record<string, LCClass> = {
  water: { alb: 0.06, sens: 0.03, iner: 0.95, pri: 6 },
  ice: { alb: 0.45, sens: 0.05, iner: 0.90, pri: 6 },     // glaciers / permanent snow — reflective and cold, no thermals
  forest: { alb: 0.12, sens: 0.20, iner: 0.45, pri: 5 },
  urban: { alb: 0.12, sens: 0.70, iner: 0.85, pri: 4 },   // dark, dry, impervious → strong sensible heat (urban heat island), stored & released late
  bare: { alb: 0.30, sens: 0.75, iner: 0.65, pri: 3 },
  farm: { alb: 0.20, sens: 0.52, iner: 0.35, pri: 2 },
  grass: { alb: 0.22, sens: 0.35, iner: 0.30, pri: 1 },
};
export const LC_DEFAULT: LCClass = { alb: 0.20, sens: 0.40, iner: 0.40, pri: 0 };

function classify(t: Record<string, string>): LCClass | null {
  const lu = t.landuse, nat = t.natural;
  if (nat === 'water' || nat === 'bay' || nat === 'strait' || nat === 'wetland' || lu === 'reservoir' || lu === 'basin') return CLS.water;
  if (nat === 'glacier') return CLS.ice;
  if (nat === 'wood' || lu === 'forest') return CLS.forest;
  if (lu === 'residential' || lu === 'industrial' || lu === 'commercial' || lu === 'retail' || lu === 'farmyard'
    || lu === 'construction' || lu === 'garages' || lu === 'railway' || lu === 'landfill' || lu === 'port' || lu === 'harbour') return CLS.urban;
  if (nat === 'bare_rock' || nat === 'scree' || nat === 'sand' || nat === 'beach' || nat === 'fell' || nat === 'shingle' || nat === 'rock' || lu === 'quarry') return CLS.bare;
  if (lu === 'farmland' || lu === 'vineyard' || lu === 'orchard' || lu === 'greenfield') return CLS.farm;
  if (lu === 'meadow' || lu === 'grass' || nat === 'grassland' || nat === 'scrub' || nat === 'heath') return CLS.grass;
  return null;
}

interface Poly { cls: LCClass; bb: [number, number, number, number]; ring: number[] }   // bb=[minLon,minLat,maxLon,maxLat], ring = flat lon,lat,…
export interface LC { polys: Poly[] }
/** True for the built-up (residential/industrial/…) class — used to place procedural buildings. */
export function isUrbanClass(c: LCClass): boolean { return c === CLS.urban; }

const cache = new Map<string, LC | null>();
const inflight = new Set<string>();
let ver = 0;
export const lcVersion = (): number => ver;

async function fetchLC(key: string, s: number, w: number, n: number, e: number): Promise<void> {
  // Fetch ways AND relations: big built-up areas / lakes / forests are often tagged as
  // multipolygon relations, and missing them left towns unclassified (→ under-heated).
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:30];(way["landuse"](${bb});relation["landuse"](${bb});way["natural"](${bb});relation["natural"](${bb}););out geom;`;
  type Geo = { lat: number; lon: number };
  try {
    const data = await overpass(q) as { elements?: Array<{ type: string; geometry?: Geo[]; members?: Array<{ type: string; role?: string; geometry?: Geo[] }>; tags?: Record<string, string> }> } | null;
    if (!data) return;   // failed / backing off — leave uncached so it retries once Overpass is back
    const polys: Poly[] = [];
    const addRing = (cls: LCClass, geom?: Geo[]): void => {
      if (!geom || geom.length < 3) return;
      const ring: number[] = []; let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
      for (const p of geom) { ring.push(p.lon, p.lat); if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon; if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; }
      polys.push({ cls, bb: [minLon, minLat, maxLon, maxLat], ring });
    };
    // A multipolygon's outer boundary is often split across several member ways (open arcs),
    // so stitch them end-to-end into closed rings — otherwise big lakes/forests aren't filled
    // and fall back to the default surface (e.g. spurious thermals over a lake).
    const kkey = (p: Geo): string => p.lon.toFixed(6) + ',' + p.lat.toFixed(6);
    const assembleRings = (members: Array<{ type: string; role?: string; geometry?: Geo[] }>): Geo[][] => {
      const ways = members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry && m.geometry.length >= 2).map(m => m.geometry as Geo[]);
      const used = new Array(ways.length).fill(false), rings: Geo[][] = [];
      for (let i = 0; i < ways.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        let ring = ways[i].slice(), grew = true;
        while (grew && kkey(ring[0]) !== kkey(ring[ring.length - 1])) {
          grew = false;
          const end = ring[ring.length - 1];
          for (let j = 0; j < ways.length; j++) {
            if (used[j]) continue;
            const w = ways[j];
            if (kkey(w[0]) === kkey(end)) { ring = ring.concat(w.slice(1)); used[j] = true; grew = true; break; }
            if (kkey(w[w.length - 1]) === kkey(end)) { ring = ring.concat(w.slice(0, -1).reverse()); used[j] = true; grew = true; break; }
          }
        }
        if (ring.length >= 3) rings.push(ring);
      }
      return rings;
    };
    for (const el of (data.elements || [])) {
      const cls = classify(el.tags || {}); if (!cls) continue;
      if (el.type === 'way') addRing(cls, el.geometry);
      else if (el.type === 'relation' && el.members) for (const ring of assembleRings(el.members)) addRing(cls, ring);   // outer rings only (holes ignored)
    }
    cache.set(key, { polys });
  } catch { /* parse error — skip (uncached, retried later) */ }
  ver++;   // consumers re-read (their caches key on lcVersion())
}

const bboxKey = (cLat: number, cLon: number, R: number): string => `${cLat.toFixed(2)}|${cLon.toFixed(2)}|${Math.round(R / 1000)}`;

/** Land-cover for the view (Overpass), or null while loading / on failure. Kicks off
 *  one background fetch per bbox; lcVersion() bumps when a result arrives. */
export function getLC(cLat: number, cLon: number, R: number): LC | null {
  const key = bboxKey(cLat, cLon, R);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!inflight.has(key) && !overpassDown()) {
    inflight.add(key);
    const mLat = M_PER_LAT, mLng = mPerLng(cLat), dLat = R / mLat, dLon = R / mLng;
    fetchLC(key, cLat - dLat, cLon - dLon, cLat + dLat, cLon + dLon).finally(() => inflight.delete(key));
  }
  return null;
}

// Ray-casting point-in-polygon over a flat [lon,lat,…] ring.
function inRing(ring: number[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Rasterise the land-cover onto a GN×GN grid → per-node albedo + sensible fraction
 *  (defaults where no polygon covers a node; highest-priority class wins overlaps). */
export function sampleGrid(lc: LC, cLat: number, cLon: number, R: number, GN: number): { alb: Float32Array; sens: Float32Array; iner: Float32Array } {
  const mLat = M_PER_LAT, mLng = mPerLng(cLat), sp = (2 * R) / (GN - 1);
  const alb = new Float32Array(GN * GN).fill(LC_DEFAULT.alb), sens = new Float32Array(GN * GN).fill(LC_DEFAULT.sens);
  const iner = new Float32Array(GN * GN).fill(LC_DEFAULT.iner), pri = new Int8Array(GN * GN);
  const nlon = (i: number) => cLon + (-R + i * sp) / mLng, nlat = (j: number) => cLat + (-R + j * sp) / mLat;
  const idxLon = (lon: number) => ((lon - cLon) * mLng + R) / sp, idxLat = (lat: number) => ((lat - cLat) * mLat + R) / sp;
  for (const p of lc.polys) {
    const i0 = Math.max(0, Math.floor(idxLon(p.bb[0]))), i1 = Math.min(GN - 1, Math.ceil(idxLon(p.bb[2])));
    const j0 = Math.max(0, Math.floor(idxLat(p.bb[1]))), j1 = Math.min(GN - 1, Math.ceil(idxLat(p.bb[3])));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * GN + i; if (pri[idx] >= p.cls.pri) continue;
      if (inRing(p.ring, nlon(i), nlat(j))) { pri[idx] = p.cls.pri; alb[idx] = p.cls.alb; sens[idx] = p.cls.sens; iner[idx] = p.cls.iner; }
    }
  }
  return { alb, sens, iner };
}
