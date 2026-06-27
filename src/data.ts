// ============ data fetching & render-state assembly ============
import { S } from './state';
import { API_BASE, PALETTE } from './config';
import { parseTz, parseIGC, pool } from './igc';
import { t } from './i18n';
import { statusEl, loadBtn, subjEl, viewsEl, playBtn, icaoEl } from './dom';
import { render } from './render';
import { buildLegend, syncUI, applyFollowClass, setCollapsed } from './ui';
import { buildRel } from './flight-math';
import type { FBLogbook, FBDevice, FetchResult, FBAirfield, Track, RGB } from './types';

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

export async function loadFlights(icao: string, date: string): Promise<void> {
  if (!icao || icao.length < 3) { setStatus(t('errLoad'), 'err'); return; }
  S.date = date; // for the sun/sky computation
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
    rebuild(res.af, res.tzoff, false);
    statusMsgInner(date, S.RAW.length);
  } catch (e) { setStatus(t('errLoad'), 'err'); }
  loadBtn.disabled = false;
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
  S.TRACKS = tracks.map(tr => ({
    ...tr, color: tr.color!,
    rel: buildRel(tr.path, S.G0, S.spline),
    rstart: tr.tstart - S.G0, rend: tr.tend - S.G0,
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
