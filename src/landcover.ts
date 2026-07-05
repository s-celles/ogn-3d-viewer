// ============ OSM land-cover for the thermal model (albedo + sensible fraction) =====
// Overpass landuse/natural polygons for the view, offline-first, cached by bbox, then
// rasterised onto the thermal grid so the potential varies over flat terrain too (dry
// fields / bare ground pump; forest, water barely). Typical albedo + sensible-heat
// fraction per class. Ways only (v1) — some large multipolygon forests/lakes may be
// missed. Rough and illustrative — see the docs.
import { S } from './state';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export interface LCClass { alb: number; sens: number; pri: number }   // albedo, sensible fraction, priority on overlap
const CLS: Record<string, LCClass> = {
  water: { alb: 0.06, sens: 0.03, pri: 6 },
  forest: { alb: 0.12, sens: 0.20, pri: 5 },
  urban: { alb: 0.15, sens: 0.60, pri: 4 },
  bare: { alb: 0.30, sens: 0.75, pri: 3 },
  farm: { alb: 0.20, sens: 0.52, pri: 2 },
  grass: { alb: 0.22, sens: 0.35, pri: 1 },
};
export const LC_DEFAULT: LCClass = { alb: 0.20, sens: 0.40, pri: 0 };

function classify(t: Record<string, string>): LCClass | null {
  const lu = t.landuse, nat = t.natural;
  if (nat === 'water' || lu === 'reservoir' || lu === 'basin') return CLS.water;
  if (nat === 'wood' || lu === 'forest') return CLS.forest;
  if (lu === 'residential' || lu === 'industrial' || lu === 'commercial' || lu === 'retail' || lu === 'farmyard') return CLS.urban;
  if (nat === 'bare_rock' || nat === 'scree' || nat === 'sand' || nat === 'beach' || nat === 'fell' || nat === 'shingle') return CLS.bare;
  if (lu === 'farmland' || lu === 'vineyard' || lu === 'orchard' || lu === 'greenfield') return CLS.farm;
  if (lu === 'meadow' || lu === 'grass' || nat === 'grassland' || nat === 'scrub' || nat === 'heath') return CLS.grass;
  return null;
}

interface Poly { cls: LCClass; bb: [number, number, number, number]; ring: number[] }   // bb=[minLon,minLat,maxLon,maxLat], ring = flat lon,lat,…
export interface LC { polys: Poly[] }

const cache = new Map<string, LC | null>();
const inflight = new Set<string>();
let ver = 0;
export const lcVersion = (): number => ver;

async function fetchLC(key: string, s: number, w: number, n: number, e: number): Promise<void> {
  const q = `[out:json][timeout:30];(way["landuse"](${s},${w},${n},${e});way["natural"](${s},${w},${n},${e}););out geom;`;
  try {
    const res = await fetch(OVERPASS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json() as { elements?: Array<{ type: string; geometry?: Array<{ lat: number; lon: number }>; tags?: Record<string, string> }> };
    const polys: Poly[] = [];
    for (const el of (data.elements || [])) {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
      const cls = classify(el.tags || {}); if (!cls) continue;
      const ring: number[] = []; let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
      for (const p of el.geometry) { ring.push(p.lon, p.lat); if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon; if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; }
      polys.push({ cls, bb: [minLon, minLat, maxLon, maxLat], ring });
    }
    cache.set(key, { polys });
  } catch { cache.set(key, null); }
  ver++;   // consumers re-read (their caches key on lcVersion())
}

const bboxKey = (cLat: number, cLon: number, R: number): string => `${cLat.toFixed(2)}|${cLon.toFixed(2)}|${Math.round(R / 1000)}`;

/** Land-cover for the view (Overpass), or null while loading / on failure. Kicks off
 *  one background fetch per bbox; lcVersion() bumps when a result arrives. */
export function getLC(cLat: number, cLon: number, R: number): LC | null {
  const key = bboxKey(cLat, cLon, R);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!inflight.has(key)) {
    inflight.add(key);
    const mLat = 111320, mLng = 111320 * Math.cos(cLat * Math.PI / 180), dLat = R / mLat, dLon = R / mLng;
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
export function sampleGrid(lc: LC, cLat: number, cLon: number, R: number, GN: number): { alb: Float32Array; sens: Float32Array } {
  const mLat = 111320, mLng = 111320 * Math.cos(cLat * Math.PI / 180), sp = (2 * R) / (GN - 1);
  const alb = new Float32Array(GN * GN).fill(LC_DEFAULT.alb), sens = new Float32Array(GN * GN).fill(LC_DEFAULT.sens), pri = new Int8Array(GN * GN);
  const nlon = (i: number) => cLon + (-R + i * sp) / mLng, nlat = (j: number) => cLat + (-R + j * sp) / mLat;
  const idxLon = (lon: number) => ((lon - cLon) * mLng + R) / sp, idxLat = (lat: number) => ((lat - cLat) * mLat + R) / sp;
  for (const p of lc.polys) {
    const i0 = Math.max(0, Math.floor(idxLon(p.bb[0]))), i1 = Math.min(GN - 1, Math.ceil(idxLon(p.bb[2])));
    const j0 = Math.max(0, Math.floor(idxLat(p.bb[1]))), j1 = Math.min(GN - 1, Math.ceil(idxLat(p.bb[3])));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * GN + i; if (pri[idx] >= p.cls.pri) continue;
      if (inRing(p.ring, nlon(i), nlat(j))) { pri[idx] = p.cls.pri; alb[idx] = p.cls.alb; sens[idx] = p.cls.sens; }
    }
  }
  return { alb, sens };
}
