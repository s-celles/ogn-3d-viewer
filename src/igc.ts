// ============ IGC / timezone parsing & a tiny fetch pool ============
import type { TrackPoint } from './types';

/** Parse a "+HHMM" / "-HHMM" UTC offset string into fractional hours. */
export function parseTz(s: string | undefined | null): number {
  const m = /([+-]\d{2})(\d{2})/.exec(s || '');
  return m ? (+m[1]) + (+m[2]) / 60 : 0;
}

/** Parse an IGC flight log into [lon, lat, gpsAlt, secondsOfDay] points (B-records only). */
export function parseIGC(txt: string): TrackPoint[] {
  const pts: TrackPoint[] = [];
  for (const line of txt.split('\n')) {
    if (line[0] !== 'B' || line.length < 35) continue;
    const tt = (+line.slice(1, 3)) * 3600 + (+line.slice(3, 5)) * 60 + (+line.slice(5, 7));
    let lat = (+line.slice(7, 9)) + ((+line.slice(9, 11)) + (+line.slice(11, 14)) / 1000) / 60; if (line[14] === 'S') lat = -lat;
    let lon = (+line.slice(15, 18)) + ((+line.slice(18, 20)) + (+line.slice(20, 23)) / 1000) / 60; if (line[23] === 'W') lon = -lon;
    // Prefer GNSS altitude (cols 30-35); fall back to pressure altitude (cols
    // 25-30) when there's no GPS fix, so local files without a GPS fix still plot.
    const gps = +line.slice(30, 35), prs = +line.slice(25, 30), alt = gps > 0 ? gps : (prs > 0 ? prs : 0);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([+lon.toFixed(6), +lat.toFixed(6), alt, tt]);
  }
  return pts;
}

export interface IgcHeaders { date: string | null; reg: string | null; comp: string | null; gliderType: string | null; pilot: string | null; }

/** Pull the useful H-record metadata out of an IGC header (date, IDs, type). */
export function parseIgcHeaders(txt: string): IgcHeaders {
  const h: IgcHeaders = { date: null, reg: null, comp: null, gliderType: null, pilot: null };
  const grab = (re: RegExp): string | null => { const m = re.exec(txt); const v = m && m[1].trim(); return v ? v : null; };
  const dm = /HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/.exec(txt);
  if (dm) h.date = `20${dm[3]}-${dm[2]}-${dm[1]}`;             // DDMMYY → YYYY-MM-DD
  h.reg = grab(/HFGID(?:GLIDERID)?:\s*(.*)/i);
  h.comp = grab(/HFCID(?:COMPETITIONID)?:\s*(.*)/i);
  h.gliderType = grab(/HFGTY(?:GLIDERTYPE)?:\s*(.*)/i);
  h.pilot = grab(/HFPLT(?:PILOTINCHARGE)?:\s*(.*)/i);
  return h;
}

/** Run `worker` over `items` with at most `n` concurrent calls. */
export async function pool<T>(items: T[], n: number, worker: (item: T) => Promise<void>): Promise<void> {
  const q = items.slice();
  const runners = Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) { await worker(q.shift() as T); }
  });
  await Promise.all(runners);
}
