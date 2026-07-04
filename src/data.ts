// ============ data fetching & render-state assembly ============
import UPNG from 'upng-js';
import { S } from './state';
import { API_BASE, PALETTE, TERRAIN, GAP_MIN, GAP_FACTOR, MINZ, MAXZ, clampv, OVERVIEW_MINZOOM } from './config';
import { parseTz, parseIGC, pool } from './igc';
import { parseTrackFile, TRACK_EXT } from './track-import';
import { t } from './i18n';
import { statusEl, loadBtn, subjEl, viewsEl, playBtn, icaoEl } from './dom';
import { render } from './render';
import { buildLegend, syncUI, applyFollowClass, setCollapsed } from './ui';
import { buildRel } from './flight-math';
import type { FBLogbook, FBDevice, FetchResult, FBAirfield, Track, TrackPoint, RGB, ViewStateLike } from './types';

interface Task { dev: FBDevice; t0: number; t1: number; maxalt: number; stop: number; }

/** Stable colour per registration, recycled across the palette. */
export function colorFor(reg: string): RGB {
  if (!(reg in S.COLOR)) S.COLOR[reg] = PALETTE[S.colorN++ % PALETTE.length];
  return S.COLOR[reg];
}

export function setStatus(msg: string, cls?: string): void {
  statusEl.className = 'status' + (cls ? (' ' + cls) : '');
  statusEl.textContent = msg;
}

// In-memory, session-only cache of full airfield/date loads, so revisiting a day
// already seen (clicking around Discover / Hot spots, reopening a shared link)
// doesn't re-hit the FlightBook API. Deliberately NOT persisted — nothing from OGN
// is written to disk or kept beyond the tab — and TTL-bounded well under OGN's
// 24 h retention window, so we never serve tracks OGN has since purged. Live
// refreshes (onlyActive) always bypass it to stay real-time.
interface CachedLoad { at: number; res: FetchResult; }
const loadCache = new Map<string, CachedLoad>();
const CACHE_MAX = 24;   // LRU cap (bounds memory when clicking through many spots)
function cacheTtlMs(date: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return date === today ? 60_000 : 60 * 60_000;   // today refreshes fast; past days ~1 h (≪ 24 h)
}

export async function fetchData(icao: string, date: string, onlyActive: boolean): Promise<FetchResult | null> {
  const cacheKey = `${icao}|${date}`;
  if (!onlyActive) {
    const hit = loadCache.get(cacheKey);
    if (hit && Date.now() - hit.at < cacheTtlMs(date)) {
      loadCache.delete(cacheKey); loadCache.set(cacheKey, hit);   // LRU touch
      return { af: hit.res.af, tzoff: hit.res.tzoff, tracks: [...hit.res.tracks] };   // fresh array; tracks are read-only downstream
    }
  }
  const lb = await fetch(`${API_BASE}/api/logbook/${encodeURIComponent(icao)}/${date}`).then(r => r.json()) as FBLogbook;
  const af = lb.airfield;
  if (!af || !af.latlng) return null;
  const tzoff = parseTz(af.time_info && af.time_info.tz_offset);
  const devices = lb.devices || [], flights = lb.flights || [];
  const nowTsp = Math.floor(Date.now() / 1000);
  let tasks: Task[] = flights.map(f => {
    const dev = devices[f.device];
    if (!dev || f.start_tsp == null || dev.address[0] === '_') return null;
    // Anonymous OGN IDs ('~', random/stealth) have no stable identity: skip them
    // in replay, but keep them in live so the view matches the FlightBook map.
    if (!S.live && dev.address[0] === '~') return null;
    // A flight still in progress has no stop yet — that's how the logbook marks
    // currently-airborne aircraft. Fetch its IGC up to now so it actually shows
    // (presence() then renders it at its latest beacon).
    const stop = f.stop_tsp ?? nowTsp;
    return { dev, t0: f.start_tsp - 30, t1: stop + 30, maxalt: f.max_alt, stop };
  }).filter((x): x is Task => x !== null);
  // Live refresh only re-fetches flights seen in the last ~20 min (the growing
  // ones). Otherwise skip flights whose IGC is surely gone (OGN keeps it ~24 h):
  // those return a 204 with no CORS header, flooding the console for old dates.
  if (onlyActive) tasks = tasks.filter(task => task.stop >= nowTsp - 1200);
  else tasks = tasks.filter(task => task.stop >= nowTsp - 26 * 3600);
  const tracks: Track[] = [];
  await pool(tasks, 4, async (task) => {
    try {
      const txt = await fetch(`${API_BASE}/api/live/igc/${task.dev.address}/${task.t0}/${task.t1}?date=${date}`).then(r => r.text());
      const pts = parseIGC(txt);
      if (pts.length >= 2) tracks.push({
        label: task.dev.aircraft || '?',
        reg: task.dev.registration || task.dev.competition || task.dev.address.slice(-5),
        type: task.dev.aircraft_type ?? 0,
        path: pts, tstart: pts[0][3], tend: pts[pts.length - 1][3],
        maxalt: task.maxalt || Math.max(...pts.map(p => p[2])),
      });
    } catch (e) { /* IGC unavailable (>24 h or no reception) */ }
  });
  const result: FetchResult = { af, tzoff, tracks };
  if (!onlyActive) {   // cache full loads only (a copy, isolated from S.RAW); keep the LRU bounded
    loadCache.set(cacheKey, { at: Date.now(), res: { af, tzoff, tracks: tracks.slice() } });
    while (loadCache.size > CACHE_MAX) loadCache.delete(loadCache.keys().next().value as string);
  }
  return result;
}

function statusMsgInner(date: string | null, n: number): void {
  let msg = n + ' ' + t('flights');
  const today = new Date().toISOString().slice(0, 10);
  if (S.live) msg = t('liveLabel') + ' · ' + msg;
  else if (date && date !== today) msg += ' · ' + t('tracksNote');
  setStatus(msg, (!S.live && date && date !== today) ? 'warn' : '');
}
export { statusMsgInner as statusMsg };

// Reflect the current airfield/date/mode in the URL (?icao=…&mode=…[&date=…])
// without adding a history entry, so the page can be shared or linked back from
// the FlightBook. Live links carry mode=live and drop the date (live is always
// "now"); replay links carry mode=replay and the chosen date.
export function syncUrl(icao: string, date: string): void {
  if (S.source === 'file') return;   // a local IGC session isn't URL-shareable
  try {
    const u = new URL(location.href);
    u.searchParams.set('icao', icao);
    if (S.live) {
      u.searchParams.set('mode', 'live'); u.searchParams.delete('date');
    } else {
      u.searchParams.set('mode', 'replay');
      if (date) u.searchParams.set('date', date); else u.searchParams.delete('date');
    }
    u.searchParams.set('view', S.mode);   // over / fpv / chase
    u.searchParams.delete('oaci');
    history.replaceState(null, '', u);
  } catch { /* non-browser / opaque origin */ }
}

export async function loadFlights(icao: string, date: string): Promise<void> {
  if (!icao || icao.length < 3) { setStatus(t('errLoad'), 'err'); return; }
  S.source = 'ogn'; fileGeoid = null;   // back to the OGN logbook source
  S.date = date; // for the sun/sky computation
  syncUrl(icao, date);
  loadBtn.disabled = true; setStatus(t('loading'));
  try {
    const res = await fetchData(icao, date, false);
    if (!res) { setStatus(t('noFlights')); loadBtn.disabled = false; return; }
    S.RAW = res.tracks;
    if (!S.RAW.length) {
      setStatus(t('noFlights'));
      // Still fly to the airfield so the user lands on the zone (e.g. old dates
      // whose IGC tracks have expired).
      if (res.af.latlng) S.mapTarget = { longitude: res.af.latlng[1], latitude: res.af.latlng[0], zoom: 11, pitch: 55, bearing: 0, minZoom: OVERVIEW_MINZOOM, maxPitch: 85 };
      loadBtn.disabled = false; return;
    }
    // Sample the rendered DEM at the airfield so the geoid/datum offset lands
    // aircraft on the terrain (see geoidOffset). Cached for live refreshes.
    afDemElev = res.af.latlng ? await terrainElevAt(res.af.latlng[0], res.af.latlng[1]) : null;
    rebuild(res.af, res.tzoff, false);
    statusMsgInner(date, S.RAW.length);
  } catch (e) { setStatus(t('errLoad'), 'err'); }
  loadBtn.disabled = false;
}

// Sample the rendered terrain (terrarium DEM, orthometric) elevation at a
// lng/lat by fetching + decoding the tile that contains it. Same decode as
// terrain.ts: elev = R*256 + G + B/256 - 32768. Returns null on failure.
async function terrainElevAt(lat: number, lon: number): Promise<number | null> {
  const z = 13, n = 2 ** z;
  const xf = (lon + 180) / 360 * n, latR = lat * Math.PI / 180;
  const yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
  const x = Math.floor(xf), y = Math.floor(yf);
  const url = TERRAIN.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  try {
    const buf = await fetch(url).then(r => r.arrayBuffer());
    const img = UPNG.decode(buf);
    const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]), w = img.width, h = img.height;
    const px = Math.min(w - 1, Math.floor((xf - x) * w)), py = Math.min(h - 1, Math.floor((yf - y) * h));
    const i = (py * w + px) * 4;
    return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768;
  } catch { return null; }
}
let afDemElev: number | null = null;   // rendered DEM elevation at the loaded airfield
let fileGeoid: number | null = null;   // geoid/datum offset for the current IGC session

// IGC GNSS altitude is WGS84 ellipsoidal (HAE), so aircraft float above the
// orthometric terrain by the geoid undulation (~+48 m in W. Europe); published
// airfield elevations can also disagree with the DEM. Estimate the offset that
// lands aircraft ON the rendered terrain. Each track's first/last points are
// take-off/landing at the home field (≈ ground level there); their MEDIAN
// altitude minus the DEM elevation at the field ≈ the offset. The median + the
// near-field filter ignore land-outs and aircraft over lower valley terrain.
// Falls back to the published elevation if the DEM sample is unavailable.
// Self-corrects MSL sources (offset ≈ 0) and is clamped so garbage can't sink
// the whole scene.
function geoidOffset(tracks: Track[], af: { lat: number; lon: number; elev: number }): number {
  const ref = afDemElev != null ? afDemElev : af.elev;
  if (!ref) return 0;                                         // no reliable reference
  const cosLat = Math.cos(af.lat * Math.PI / 180), ground: number[] = [];
  for (const tr of tracks) for (const p of [tr.path[0], tr.path[tr.path.length - 1]]) {
    const dN = (p[1] - af.lat) * 111320, dE = (p[0] - af.lon) * 111320 * cosLat;
    if (dN * dN + dE * dE < 3000 * 3000) ground.push(p[2]);   // take-off/landing at the home field
  }
  if (ground.length < 6) return 0;
  ground.sort((a, b) => a - b);
  const off = ground[ground.length >> 1] - ref;              // median ground altitude − DEM
  return Math.abs(off) <= 200 ? off : 0;
}

// Detect OGN reception losses: day-relative intervals between consecutive
// beacons longer than max(GAP_MIN, GAP_FACTOR × median interval) for the track.
function receptionGaps(path: TrackPoint[], g0: number): [number, number][] {
  if (path.length < 3) return [];
  const dts: number[] = [];
  for (let i = 1; i < path.length; i++) dts.push(path[i][3] - path[i - 1][3]);
  const med = dts.slice().sort((a, b) => a - b)[dts.length >> 1] || 1;
  const thr = Math.max(GAP_MIN, GAP_FACTOR * med);
  const gaps: [number, number][] = [];
  for (let i = 1; i < path.length; i++) {
    if (path[i][3] - path[i - 1][3] > thr) gaps.push([path[i - 1][3] - g0, path[i][3] - g0]);
  }
  return gaps;
}

// Build render-ready state from RAW. preserve=true keeps the current view,
// subject, camera and cursor (used by live refresh); false = fresh load.
export function rebuild(af: FBAirfield | null, tzoff: number | null, preserve: boolean): void {
  if (af) S.CURAF = af; if (tzoff != null) S.CURTZ = tzoff;
  const curaf = S.CURAF!;
  const tracks = S.RAW.slice().sort((a, b) => a.tstart - b.tstart);
  tracks.forEach(tr => tr.color = colorFor(tr.reg));
  const g0 = Math.min(...tracks.map(x => x.tstart)), g1 = Math.max(...tracks.map(x => x.tend));
  S.AF = { name: curaf.name, code: curaf.code, lon: curaf.latlng[1], lat: curaf.latlng[0], elev: curaf.elevation || 0, tz_off: S.CURTZ };
  S.G0 = g0; S.G1 = g1; S.SPAN = Math.max(1, S.G1 - S.G0);
  // before buildRel (which subtracts it). IGC sessions use a field-agnostic
  // per-point geoid estimate computed at load (works across several airfields).
  S.altOffset = S.source === 'file' && fileGeoid != null ? fileGeoid : geoidOffset(tracks, S.AF);
  S.TRACKS = tracks.map(tr => ({
    ...tr, color: tr.color!,
    rel: buildRel(tr.path, S.G0, S.spline),
    rstart: tr.tstart - S.G0, rend: tr.tend - S.G0,
    gaps: receptionGaps(tr.path, S.G0),
  }));
  if (!preserve) {
    S.subject = S.TRACKS[0].reg; S.solo = null; S.cur = 0; S.playing = true; S.mode = 'over';
    document.body.classList.remove('fpv'); applyFollowClass();
    S.INIT = { longitude: S.AF.lon, latitude: S.AF.lat, zoom: 11.3, pitch: 62, bearing: 0, minZoom: OVERVIEW_MINZOOM, maxPitch: 85 };
    S.mapTarget = { ...S.INIT };
  } else {
    if (!S.TRACKS.some(tr => tr.reg === S.subject)) S.subject = S.TRACKS[0].reg;
    if (S.solo && !S.TRACKS.some(tr => tr.reg === S.solo)) S.solo = null;
  }
  subjEl.innerHTML = '';
  const seenReg = new Set<string>();   // one entry per registration (a glider may have several flights that day)
  S.TRACKS.forEach(tr => {
    if (seenReg.has(tr.reg)) return; seenReg.add(tr.reg);
    const o = document.createElement('option'); o.value = tr.reg;
    o.textContent = `${tr.reg} — ${tr.label}`; subjEl.appendChild(o);
  });
  subjEl.value = S.subject!;
  S.ready = true; document.body.classList.add('loaded');
  [...viewsEl.children].forEach(c => { const el = c as HTMLElement; el.classList.toggle('on', el.dataset.m === S.mode); });
  playBtn.textContent = S.playing ? t('pause') : t('play'); playBtn.classList.toggle('on', S.playing);
  buildLegend(); render(); syncUI();
  if (!preserve && window.innerWidth <= 640) setCollapsed(true);
}

export async function refreshLive(): Promise<void> {
  if (!S.live) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetchData(icaoEl.value.trim().toUpperCase(), today, true);
    if (res && res.tracks.length) {
      const byReg = new Map(S.RAW.map(tr => [tr.reg, tr] as [string, Track]));
      res.tracks.forEach(tr => byReg.set(tr.reg, tr)); // upsert active flights
      S.RAW = [...byReg.values()];
      rebuild(res.af, res.tzoff, true);
      statusMsgInner(null, S.RAW.length);
    }
  } catch (e) { /* transient network error: keep last frame, try again next tick */ }
  if (S.live) S.liveTimer = setTimeout(refreshLive, 20000);
}

// ---- local IGC files (offline replay, synthetic airfield) ----

// Fit all tracks in view: bounding-box centre + a Web-Mercator zoom framing the
// lon/lat extent in the current viewport (with margin).
function fitBoundsView(tracks: Track[]): ViewStateLike {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const tr of tracks) for (const p of tr.path) {
    if (p[0] < minLon) minLon = p[0]; if (p[0] > maxLon) maxLon = p[0];
    if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
  }
  const lon = (minLon + maxLon) / 2, lat = (minLat + maxLat) / 2;
  const W = (typeof window !== 'undefined' ? window.innerWidth : 1000) * 0.82;
  const H = (typeof window !== 'undefined' ? window.innerHeight : 700) * 0.82;
  const merc = (d: number) => Math.log(Math.tan(Math.PI / 4 + d * Math.PI / 360));
  const fracX = Math.max(1e-6, (maxLon - minLon) / 360);
  const fracY = Math.max(1e-6, Math.abs(merc(maxLat) - merc(minLat)) / (2 * Math.PI));
  const zoom = clampv(Math.min(Math.log2(W / (256 * fracX)), Math.log2(H / (256 * fracY))), MINZ, MAXZ);
  return { longitude: lon, latitude: lat, zoom, pitch: 55, bearing: 0, minZoom: OVERVIEW_MINZOOM, maxPitch: 85 };
}

// Field-agnostic geoid/datum offset: median of (GNSS altitude − DEM elevation)
// sampled at every track's take-off and landing point. Works across several
// airfields (the geoid varies slowly) and tolerates land-outs.
async function computeFileGeoid(tracks: Track[]): Promise<number> {
  const ground = tracks.flatMap(tr => [tr.path[0], tr.path[tr.path.length - 1]]);
  const diffs: number[] = [];
  await pool(ground, 4, async (p) => {
    const dem = await terrainElevAt(p[1], p[0]);
    if (dem != null && dem > -1000) diffs.push(p[2] - dem);
  });
  if (diffs.length < 2) return 0;
  diffs.sort((a, b) => a - b);
  const off = diffs[diffs.length >> 1];
  return Math.abs(off) <= 200 ? off : 0;
}

/**
 * Load one or more local IGC files and replay them — no FlightBook / OGN call
 * (only the basemap terrain tiles still stream). append=true merges into the
 * current scene (drag-drop); false replaces it (file picker). All tracks must
 * share the take-off date; a file from another day is skipped with a notice.
 */
export async function loadTrackFiles(fileList: FileList | File[], append: boolean): Promise<void> {
  const files = [...fileList].filter(f => TRACK_EXT.test(f.name));
  if (!files.length) { setStatus(t('igcNone'), 'err'); return; }
  S.live = false; if (S.liveTimer) { clearTimeout(S.liveTimer); S.liveTimer = null; }
  setStatus(t('loading'));
  const fresh = !append || !S.ready;
  let baseDate: string | null = fresh ? null : S.date;
  let skipped = 0;
  const newTracks: Track[] = [];
  const usedRegs = new Set<string>(fresh ? [] : S.RAW.map(tr => tr.reg));
  for (const f of files) {
    let txt = '';
    try { txt = await f.text(); } catch { skipped++; continue; }
    const parsed = parseTrackFile(f.name, txt);
    // Enforce a single take-off day (the engine is day-relative); skip others.
    if (parsed.date) { if (!baseDate) baseDate = parsed.date; else if (parsed.date !== baseDate) { skipped += parsed.tracks.length || 1; continue; } }
    if (!parsed.tracks.length) { skipped++; continue; }
    const base = f.name.replace(TRACK_EXT, '');
    parsed.tracks.forEach((it, i) => {
      if (it.pts.length < 2) { skipped++; return; }
      let reg = it.reg || it.name || (parsed.tracks.length > 1 ? `${base} #${i + 1}` : base);
      while (usedRegs.has(reg)) reg += '·';                 // unique reg (colour / subject keying)
      usedRegs.add(reg);
      newTracks.push({
        label: it.name || it.reg || base, reg, type: it.type ?? 1,
        path: it.pts, tstart: it.pts[0][3], tend: it.pts[it.pts.length - 1][3],
        maxalt: Math.max(...it.pts.map(q => q[2])),
      });
    });
  }
  if (!newTracks.length) { setStatus(t('noFlights')); return; }
  S.source = 'file';
  if (!fresh && S.RAW.length) {
    const byReg = new Map(S.RAW.map(tr => [tr.reg, tr] as [string, Track]));
    newTracks.forEach(tr => byReg.set(tr.reg, tr));
    S.RAW = [...byReg.values()];
  } else {
    S.RAW = newTracks;
  }
  S.date = baseDate || S.date || new Date().toISOString().slice(0, 10);
  // Synthetic airfield: centroid of the take-off points, DEM elevation there,
  // and a longitude-derived timezone (only affects the clock + sun position).
  const tos = S.RAW.map(tr => tr.path[0]);
  const cLon = tos.reduce((s, p) => s + p[0], 0) / tos.length;
  const cLat = tos.reduce((s, p) => s + p[1], 0) / tos.length;
  const tz = Math.round(cLon / 15);
  fileGeoid = await computeFileGeoid(S.RAW);
  const elev = await terrainElevAt(cLat, cLon);
  const af: FBAirfield = { name: 'import', code: '', latlng: [cLat, cLon], elevation: elev ?? 0 };
  // Drop any OGN deep-link params — a file session isn't shareable by URL.
  if (fresh) { try { history.replaceState(null, '', location.pathname); } catch { /* opaque origin */ } }
  rebuild(af, tz, !fresh);
  if (fresh) { S.INIT = fitBoundsView(S.RAW); S.mapTarget = { ...S.INIT }; render(); }
  setStatus(`${S.RAW.length} ${t('flights')} · ${t('fileSrc')}` + (skipped ? ` · ${skipped} ${t('igcSkipped')}` : ''));
}
