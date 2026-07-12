// ============ multi-format track import (IGC / GPX / KML) ============
// Normalises several track file formats into ImportedFile { tracks, date }.
// Parsing is done with plain string/regex scanning (no DOMParser) so it works
// identically in the browser and under Bun's test runner, and stays dependency
// free. Output points are [lon, lat, alt(m), secondsOfDay(UTC)] like parseIGC.
import { parseIGC, parseIgcHeaders } from './igc';
import type { TrackPoint, ImportedTrack, ImportedFile } from './types';

// UTC seconds-of-day from an ISO timestamp (GPX/KML <time>/<when>), plus the
// matching UTC date. Returns null when unparseable.
function isoToSod(ts: string): { sod: number; date: string } | null {
  const ms = Date.parse(ts.trim());
  if (!Number.isFinite(ms)) return null;
  const sod = ((Math.floor(ms / 1000) % 86400) + 86400) % 86400;
  return { sod, date: new Date(ms).toISOString().slice(0, 10) };
}

const firstTag = (s: string, tag: string): string =>
  (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(s)?.[1] || '').trim();

// ---- GPX (<trk>/<trkseg>/<trkpt lat lon><ele><time>) ----
export function parseGPX(text: string): ImportedFile {
  const tracks: ImportedTrack[] = [];
  let date: string | null = null;
  const blocks = text.match(/<trk\b[\s\S]*?<\/trk>/g) || (/<trkpt/.test(text) ? [text] : []);
  for (const blk of blocks) {
    const name = firstTag(blk, 'name');
    const pts: TrackPoint[] = [];
    const re = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
    let m: RegExpExecArray | null, idx = 0;
    while ((m = re.exec(blk))) {
      const attrs = m[1], inner = m[2] || '';
      const lat = +(/\blat\s*=\s*"([-\d.]+)"/.exec(attrs)?.[1] ?? NaN);
      const lon = +(/\blon\s*=\s*"([-\d.]+)"/.exec(attrs)?.[1] ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const ele = +(/<ele>([-\d.]+)<\/ele>/.exec(inner)?.[1] ?? 0);
      const ts = /<time>([^<]+)<\/time>/.exec(inner)?.[1];
      let sod = idx;
      if (ts) { const r = isoToSod(ts); if (r) { sod = r.sod; if (!date) date = r.date; } }
      pts.push([+lon.toFixed(6), +lat.toFixed(6), ele || 0, sod]);
      idx++;
    }
    if (pts.length >= 2) tracks.push({ name, reg: null, type: null, pts });
  }
  return { tracks, date };
}

// ---- KML (<gx:Track> with <when>/<gx:coord>, or <LineString><coordinates>) ----
export function parseKML(text: string): ImportedFile {
  const tracks: ImportedTrack[] = [];
  let date: string | null = null;
  const placemarks = text.match(/<Placemark\b[\s\S]*?<\/Placemark>/g) || [text];
  for (const pm of placemarks) {
    const name = firstTag(pm, 'name');
    const pts: TrackPoint[] = [];
    const coords = [...pm.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map(x => x[1].trim());
    if (coords.length) {                                  // gx:Track (timestamped)
      const whens = [...pm.matchAll(/<when>([^<]+)<\/when>/g)].map(x => x[1].trim());
      coords.forEach((c, i) => {
        const [lon, lat, alt] = c.split(/\s+/).map(Number);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        let sod = i; if (whens[i]) { const r = isoToSod(whens[i]); if (r) { sod = r.sod; if (!date) date = r.date; } }
        pts.push([+lon.toFixed(6), +lat.toFixed(6), alt || 0, sod]);
      });
    } else {                                              // LineString (no time → sequential)
      const cm = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(pm);
      if (cm) cm[1].trim().split(/\s+/).forEach((tp, i) => {
        const [lon, lat, alt] = tp.split(',').map(Number);
        if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([+lon.toFixed(6), +lat.toFixed(6), alt || 0, i]);
      });
    }
    if (pts.length >= 2) tracks.push({ name, reg: null, type: null, pts });
  }
  return { tracks, date };
}

/** Parse any supported track file (dispatched by extension; IGC is the default). */
export function parseTrackFile(filename: string, text: string): ImportedFile {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'gpx') return parseGPX(text);
  if (ext === 'kml') return parseKML(text);
  const pts = parseIGC(text), h = parseIgcHeaders(text);    // IGC (and unknown extensions)
  return { date: h.date, tracks: pts.length >= 2 ? [{ name: h.gliderType || h.pilot || '', reg: h.reg || h.comp, type: 1, pts }] : [] };
}

/** Extensions accepted by the importer (file input + drag-drop). */
export const TRACK_EXT = /\.(igc|gpx|kml)$/i;
