// ============ data fetching & render-state assembly ============
import UPNG from 'upng-js';
import { S } from './state';
import { API_BASE, PALETTE, TERRAIN, GAP_MIN, GAP_FACTOR } from './config';
import { parseTz, parseIGC, pool } from './igc';
import { t } from './i18n';
import { statusEl, loadBtn, subjEl, viewsEl, playBtn, icaoEl } from './dom';
import { render } from './render';
import { buildLegend, syncUI, applyFollowClass, setCollapsed } from './ui';
import { buildRel } from './flight-math';
import type { FBLogbook, FBDevice, FetchResult, FBAirfield, Track, TrackPoint, RGB } from './types';

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

export async function fetchData(icao: string, date: string, onlyActive: boolean): Promise<FetchResult | null> {
  const lb = await fetch(`${API_BASE}/api/logbook/${encodeURIComponent(icao)}/${date}`).then(r => r.json()) as FBLogbook;
  const af = lb.airfield;
  if (!af || !af.latlng) return null;
  const tzoff = parseTz(af.time_info && af.time_info.tz_offset);
  const devices = lb.devices || [], flights = lb.flights || [];
  const nowTsp = Math.floor(Date.now() / 1000);
  let tasks: Task[] = flights.map(f => {
    const dev = devices[f.device];
    if (!dev || f.start_tsp == null || f.stop_tsp == null || dev.address[0] === '~' || dev.address[0] === '_') return null;
    return { dev, t0: f.start_tsp - 30, t1: f.stop_tsp + 30, maxalt: f.max_alt, stop: f.stop_tsp };
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
  return { af, tzoff, tracks };
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
  try {
    const u = new URL(location.href);
    u.searchParams.set('icao', icao);
    if (S.live) {
      u.searchParams.set('mode', 'live'); u.searchParams.delete('date');
    } else {
      u.searchParams.set('mode', 'replay');
      if (date) u.searchParams.set('date', date); else u.searchParams.delete('date');
    }
    u.searchParams.delete('oaci');
    history.replaceState(null, '', u);
  } catch { /* non-browser / opaque origin */ }
}

export async function loadFlights(icao: string, date: string): Promise<void> {
  if (!icao || icao.length < 3) { setStatus(t('errLoad'), 'err'); return; }
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
      if (res.af.latlng) S.mapTarget = { longitude: res.af.latlng[1], latitude: res.af.latlng[0], zoom: 11, pitch: 55, bearing: 0, maxPitch: 85 };
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
  S.altOffset = geoidOffset(tracks, S.AF);   // before buildRel (which subtracts it)
  S.TRACKS = tracks.map(tr => ({
    ...tr, color: tr.color!,
    rel: buildRel(tr.path, S.G0, S.spline),
    rstart: tr.tstart - S.G0, rend: tr.tend - S.G0,
    gaps: receptionGaps(tr.path, S.G0),
  }));
  if (!preserve) {
    S.subject = S.TRACKS[0].reg; S.solo = null; S.cur = 0; S.playing = true; S.mode = 'over';
    document.body.classList.remove('fpv'); applyFollowClass();
    S.INIT = { longitude: S.AF.lon, latitude: S.AF.lat, zoom: 11.3, pitch: 62, bearing: 0, maxPitch: 85 };
    S.mapTarget = { ...S.INIT };
  } else {
    if (!S.TRACKS.some(tr => tr.reg === S.subject)) S.subject = S.TRACKS[0].reg;
    if (S.solo && !S.TRACKS.some(tr => tr.reg === S.solo)) S.solo = null;
  }
  subjEl.innerHTML = '';
  S.TRACKS.forEach(tr => {
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
