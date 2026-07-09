// ============ shared Overpass client (mirrors + timeout + backoff) ============
// The reference overpass-api.de often refuses connections / rate-limits, and some networks
// block it outright. Race a few reliable mirrors (first to answer wins), give up on a hung
// one after a timeout, and if ALL fail, back off quietly so we don't hammer them (or flood
// the console) every frame. Returns null on failure/backoff — callers degrade gracefully.
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const TIMEOUT = 15000, COOLDOWN = 180000;
let cooldownUntil = 0;

/** True while Overpass is in a post-failure backoff (skip triggering fetches). */
export const overpassDown = (): boolean => Date.now() < cooldownUntil;

/** Run an Overpass QL query; returns the parsed JSON, or null on failure / during backoff. */
export async function overpass(query: string): Promise<any | null> {
  if (Date.now() < cooldownUntil) return null;
  const body = 'data=' + encodeURIComponent(query);
  try {
    return await Promise.any(MIRRORS.map(async url => {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), TIMEOUT);
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: ac.signal });
        if (!res.ok) throw new Error('http ' + res.status);
        return await res.json();
      } finally { clearTimeout(to); }
    }));
  } catch { cooldownUntil = Date.now() + COOLDOWN; return null; }   // all mirrors failed → back off, stay quiet
}
