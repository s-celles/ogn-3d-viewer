// ============ "Discover spots": a curated tabular data package + your own spots ============
// The built-in dataset is a Frictionless Tabular Data Package (data/spots.csv +
// data/datapackage.json), bundled as text so it works offline. Users can add
// their own spots (persisted in localStorage) and import/export them as CSV with
// the same schema. A full-screen overlay lets you pick a site by continent, with
// a world locator map (two-way hover highlighting); picking one drives the normal
// load flow.
import { S } from './state';
import { t } from './i18n';
import { TEXTURE, API_BASE } from './config';
import { icaoEl, loadBtn, discoverBtn } from './dom';
import { gotoSpot, updateFbLink, setPlace } from './ui';
import { codeCountry, codeFlag, flag as isoFlag } from './flags';
import { fetchHotZones, hotCache, hotFresh, type HotZone } from './hotspots';
import spotsCsv from '../data/spots.csv' with { type: 'text' };
import type { Lang } from './types';

interface Spot { code: string; name: string; country: string; continent: string; lat: number; lon: number; checked: string; blurb: string; user?: boolean; }

const CSV_HEADER = 'code,name,country,continent,lat,lon,flightbook_checked,blurb';
const clean = (s: string): string => (s || '').replace(/[,\r\n]/g, ' ').trim();   // keep non-blurb fields comma-free

// Parse the CSV schema (blurb is last and may contain commas → rejoin the tail).
function parseCsv(csv: string, user = false): Spot[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines[0] && lines[0].toLowerCase().startsWith('code,')) lines.shift();   // drop header if present
  return lines.filter(Boolean).map(line => {
    const p = line.split(',');
    return { code: p[0], name: p[1], country: p[2], continent: p[3], lat: +p[4], lon: +p[5], checked: p[6] || '', blurb: p.slice(7).join(','), user };
  }).filter(s => s.code && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}
function toCsv(list: Spot[]): string {
  return CSV_HEADER + '\n' + list.map(s => [s.code, s.name, s.country, s.continent, s.lat, s.lon, s.checked || '', s.blurb].join(',')).join('\n') + '\n';
}

const BUILTIN = parseCsv(spotsCsv);

// ---- user spots (localStorage) ----
const KEY = 'ogn3d.spots.v1';
let USER: Spot[] = loadUser();
function loadUser(): Spot[] {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.map((s: any) => ({ ...s, user: true })) : []; }
  catch { return []; }
}
function saveUser(): void { try { localStorage.setItem(KEY, JSON.stringify(USER)); } catch { /* private mode / quota */ } }
const allSpots = (): Spot[] => [...USER, ...BUILTIN];   // user spots first

// Continent tab order + labels (kept local rather than bloating i18n.ts).
const CONTS = ['Europe', 'North America', 'South America', 'Africa', 'Asia', 'Oceania'];
const CONT_L: Record<string, Record<Lang, string>> = {
  'Europe': { fr: 'Europe', en: 'Europe', de: 'Europa', es: 'Europa', it: 'Europa' },
  'North America': { fr: 'Amérique du Nord', en: 'North America', de: 'Nordamerika', es: 'América del Norte', it: 'Nord America' },
  'South America': { fr: 'Amérique du Sud', en: 'South America', de: 'Südamerika', es: 'América del Sur', it: 'Sud America' },
  'Africa': { fr: 'Afrique', en: 'Africa', de: 'Afrika', es: 'África', it: 'Africa' },
  'Asia': { fr: 'Asie', en: 'Asia', de: 'Asien', es: 'Asia', it: 'Asia' },
  'Oceania': { fr: 'Océanie', en: 'Oceania', de: 'Ozeanien', es: 'Oceanía', it: 'Oceania' },
};
const contLabel = (c: string): string => (CONT_L[c] && CONT_L[c][S.lang]) || c;
const flag = (iso: string): string => isoFlag(iso) || '📍';

// World locator: the whole-world z0 imagery tile (cached by the service worker);
// spots placed by web-mercator projection as percentages, so the map is responsive.
// Esri MapServer "export" endpoint: a single sharp image of any bbox, so a
// continent view isn't the z0 world tile stretched (pixelated). Cached by the SW.
const ESRI_EXPORT = TEXTURE.replace(/\/tile\/.*$/, '/export');
const MERC_E = 20037508.342789244;   // half web-mercator extent (metres)
const merX = (lon: number): number => (lon + 180) / 360;
const merY = (lat: number): number => {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
// Rough continent bounding boxes (deg) used to recenter the locator map on the
// selected continent (the overlay opens on the whole world).
const CONT_BBOX: Record<string, { n: number, s: number, w: number, e: number }> = {
  'Europe': { n: 62, s: 35, w: -11, e: 32 },
  'North America': { n: 60, s: 24, w: -125, e: -64 },
  'South America': { n: 13, s: -55, w: -82, e: -34 },
  'Africa': { n: 37, s: -35, w: -18, e: 52 },
  'Asia': { n: 55, s: 5, w: 25, e: 146 },
  'Oceania': { n: -8, s: -47, w: 110, e: 179 },
  'Antarctica': { n: -60, s: -85, w: -179, e: 179 },
};

let overlay: HTMLElement | null = null, listEl: HTMLElement | null = null, tabsEl: HTMLElement | null = null, mapEl: HTMLElement | null = null, bgEl: HTMLElement | null = null, fileInput: HTMLInputElement | null = null;
let active = '';
let view = { x0: 0, y0: 0, d: 1 };   // visible world rect (mercator 0..1), d = side
const dots = new Map<string, HTMLElement>();
const items = new Map<string, HTMLElement>();
let hotZones: HotZone[] = [];   // live hot-spots mode (active === 'hot')
let hotAt = 0;                  // timestamp of the displayed scan
let hotTimer = 0;              // interval refreshing the "updated … ago" header
const hotDots = new Map<number, HTMLElement>();
const hotItems = new Map<number, HTMLElement>();
const hotHidden = new Set<number>();            // zone indices filtered out of the current view
let hotRowsEl: HTMLElement | null = null;       // container holding just the ranked rows
interface HotFilter { country: string; sort: 'count' | 'name' | 'country'; q: string; }
const HOT_FILTER_KEY = 'ogn.hotFilter';
const hotFilterDefault: HotFilter = { country: '', sort: 'count', q: '' };
let hotFilter: HotFilter = readHotFilter();     // persisted country / sort / search, reset on demand

// Recenter the map on a continent (null = whole world). Pans/zooms the imagery
// background and repositions the (constant-size) markers accordingly.
function setView(cont: string | null): void {
  const bb = cont ? CONT_BBOX[cont] : null;
  if (bb) {
    const x0 = merX(bb.w), x1 = merX(bb.e), y0 = merY(bb.n), y1 = merY(bb.s);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = Math.min(1, Math.max(x1 - x0, y1 - y0) * 1.3);
    view = { x0: Math.max(0, Math.min(1 - d, cx - d / 2)), y0: Math.max(0, Math.min(1 - d, cy - d / 2)), d };
  } else view = { x0: 0, y0: 0, d: 1 };
  if (bgEl) {
    const mx = (f: number) => ((f * 2 - 1) * MERC_E).toFixed(0), my = (f: number) => ((1 - f * 2) * MERC_E).toFixed(0);
    const bbox = `${mx(view.x0)},${my(view.y0 + view.d)},${mx(view.x0 + view.d)},${my(view.y0)}`;
    bgEl.style.backgroundImage = `url("${ESRI_EXPORT}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image")`;
  }
  positionDots(); positionHot();
}
function positionDots(): void {
  for (const s of allSpots()) {
    const el = dots.get(s.code); if (!el) continue;
    const sx = (merX(s.lon) - view.x0) / view.d, sy = (merY(s.lat) - view.y0) / view.d;
    const vis = sx >= -0.02 && sx <= 1.02 && sy >= -0.02 && sy <= 1.02;
    el.style.display = vis ? 'block' : 'none';
    el.style.left = (sx * 100).toFixed(2) + '%'; el.style.top = (sy * 100).toFixed(2) + '%';
  }
}
const present = (): string[] => CONTS.filter(c => allSpots().some(s => s.continent === c));
const isOpen = (): boolean => !!overlay && overlay.style.display === 'flex';

function highlight(code: string, on: boolean): void {
  const d = dots.get(code);
  if (d) { d.style.transform = `translate(-50%,-50%) scale(${on ? 2 : 1})`; d.style.zIndex = on ? '3' : '1'; d.style.boxShadow = on ? '0 0 0 2px #fff' : ''; }
  const it = items.get(code);
  if (it) it.style.background = on ? 'rgba(255,255,255,.12)' : '';
  if (on && it) it.scrollIntoView({ block: 'nearest' });
}
function fromMap(s: Spot): void {
  if (active && s.continent !== active) { active = s.continent; renderTabs(); renderList(); }   // world view keeps all spots listed
  highlight(s.code, true);
}

// -------- live "hot spots": where gliders are flying right now --------
function clearHot(): void {
  if (mapEl) mapEl.querySelectorAll('[data-hot]').forEach(n => n.remove());
  hotDots.clear(); hotItems.clear(); hotZones = []; hotHidden.clear(); hotRowsEl = null;
  if (hotTimer) { clearInterval(hotTimer); hotTimer = 0; }
}
function readHotFilter(): HotFilter {
  try { return { ...hotFilterDefault, ...JSON.parse(localStorage.getItem(HOT_FILTER_KEY) || '{}') }; } catch { return { ...hotFilterDefault }; }
}
function writeHotFilter(): void { try { localStorage.setItem(HOT_FILTER_KEY, JSON.stringify(hotFilter)); } catch { /* ignore */ } }
function fmtAge(ms: number): string {
  if (ms < 15_000) return t('discoverJustNow');
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
function positionHot(): void {
  for (const [i, el] of hotDots) {
    const z = hotZones[i]; if (!z) continue;
    if (hotHidden.has(i)) { el.style.display = 'none'; continue; }   // filtered out
    const sx = (merX(z.lon) - view.x0) / view.d, sy = (merY(z.lat) - view.y0) / view.d;
    const vis = sx >= -0.02 && sx <= 1.02 && sy >= -0.02 && sy <= 1.02;
    el.style.display = vis ? 'block' : 'none';
    el.style.left = (sx * 100).toFixed(2) + '%'; el.style.top = (sy * 100).toFixed(2) + '%';
  }
}
function highlightHot(i: number, on: boolean): void {
  const d = hotDots.get(i);
  if (d) { d.style.zIndex = on ? '3' : '1'; d.style.boxShadow = on ? '0 0 0 2px #fff' : ''; d.style.filter = on ? 'brightness(1.3)' : ''; }
  const it = hotItems.get(i);
  if (it) it.style.background = on ? 'rgba(255,255,255,.12)' : '';
  if (on && it) it.scrollIntoView({ block: 'nearest' });
}
async function showHot(force = false): Promise<void> {
  if (!listEl || !mapEl) return;
  for (const el of dots.values()) el.remove(); dots.clear();   // hide spot markers while in hot mode
  clearHot();
  const cached = hotCache();
  if (!force && cached && hotFresh()) { hotZones = cached.zones; hotAt = cached.at; renderHot(); return; }   // reuse the recent scan
  listEl.innerHTML = `<div style="padding:16px;color:var(--mut)">${t('discoverLoading')} …</div>`;
  const res = await fetchHotZones(30, force).catch(() => null);
  if (active !== 'hot') return;                                 // user switched tabs during the fetch
  if (res) { hotZones = res.zones; hotAt = res.at; }
  renderHot();
}
function hotHeader(): string {                                  // "Updated … ago" + a rate-limited refresh button
  const age = Date.now() - hotAt;
  const canRefresh = !hotFresh();
  return `<div style="display:flex;align-items:center;gap:8px;padding:2px 4px 8px;font-size:12px;color:var(--mut)">`
    + `<span>${t('discoverUpdated')} · ${fmtAge(age)}</span>`
    + `<button data-hotref ${canRefresh ? '' : 'disabled'} title="${t('discoverRefresh')}" `
    + `style="margin-left:auto;padding:3px 9px;border-radius:7px;cursor:${canRefresh ? 'pointer' : 'default'};opacity:${canRefresh ? '1' : '.4'}">↻</button></div>`;
}
function tickHot(): void {                                      // keep the age label / button state live
  if (active !== 'hot' || !listEl) return;
  const head = listEl.querySelector('[data-hothead]') as HTMLElement | null;
  if (head) head.innerHTML = hotHeader();
  const btn = listEl.querySelector('[data-hotref]') as HTMLButtonElement | null;
  if (btn) btn.onclick = () => { if (!hotFresh()) void showHot(true); };
}
function renderHot(): void {   // build the markers + the static shell (header, controls, rows container)
  if (!listEl || !mapEl) return;
  const max = hotZones[0]?.count || 1;
  hotZones.forEach((z, i) => {
    const el = document.createElement('div'); el.dataset.hot = String(i);
    const sz = 8 + Math.round(14 * z.count / max);
    el.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;transform:translate(-50%,-50%);cursor:pointer;transition:transform .1s,left .35s,top .35s;border:1px solid rgba(0,0,0,.7);background:#ff5a3c;z-index:1`;
    const ti = zoneInfo(z);
    el.title = `${ti.flag} ${ti.name || ti.code} · ${z.count}`;
    el.onmouseenter = () => highlightHot(i, true); el.onmouseleave = () => highlightHot(i, false);
    el.onclick = () => pickZone(z);
    hotDots.set(i, el); mapEl!.appendChild(el);
  });
  listEl.innerHTML = '';
  const head = document.createElement('div'); head.dataset.hothead = ''; head.innerHTML = hotHeader();
  listEl.appendChild(head);
  if (hotZones.length) listEl.appendChild(buildHotControls());
  hotRowsEl = document.createElement('div'); listEl.appendChild(hotRowsEl);
  renderHotRows();
  tickHot();                                   // wire the refresh button now
  if (!hotTimer) hotTimer = setInterval(tickHot, 5000) as unknown as number;   // keep the age label live
  void enrichHotNames();                        // resolve airfield names in the background
}
function hotView(infos: ZoneInfo[]): number[] {   // indices after country/search filter + sort
  const q = hotFilter.q.trim().toLowerCase();
  const view = hotZones.map((_, i) => i).filter(i => {
    const inf = infos[i];
    if (hotFilter.country && inf.country !== hotFilter.country) return false;
    if (q && !`${inf.name} ${inf.code} ${inf.country}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (hotFilter.sort === 'name') view.sort((a, b) => (infos[a].name || infos[a].code).localeCompare(infos[b].name || infos[b].code));
  else if (hotFilter.sort === 'country') view.sort((a, b) => infos[a].country.localeCompare(infos[b].country) || hotZones[b].count - hotZones[a].count);
  else view.sort((a, b) => hotZones[b].count - hotZones[a].count);
  return view;
}
function renderHotRows(): void {   // rebuild just the ranked rows (leaves the controls, so search keeps focus)
  if (!hotRowsEl) return;
  const infos = hotZones.map(zoneInfo);
  const view = hotView(infos);
  hotHidden.clear(); const shown = new Set(view);
  hotZones.forEach((_, i) => { if (!shown.has(i)) hotHidden.add(i); });
  positionHot();
  hotRowsEl.innerHTML = ''; hotItems.clear();
  if (!hotZones.length) { hotRowsEl.innerHTML = `<div style="padding:16px;color:var(--mut)">${t('discoverHotNone')}</div>`; return; }
  if (!view.length) { hotRowsEl.innerHTML = `<div style="padding:16px;color:var(--mut)">${t('discoverHotNoMatch')}</div>`; return; }
  for (const i of view) {
    const z = hotZones[i], info = infos[i];
    const d = document.createElement('div');
    d.style.cssText = 'padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;gap:10px;align-items:center';
    d.onmouseenter = () => highlightHot(i, true); d.onmouseleave = () => highlightHot(i, false);
    d.onclick = () => pickZone(z);
    d.innerHTML = `<b style="color:#ff5a3c;min-width:28px;text-align:right" title="${z.count} ${t('discoverGliders')}">${z.count}</b>`
      + `<span style="font-size:16px">${info.flag || '📍'}</span>`
      + `<div data-nm style="flex:1;min-width:0">${hotRowText(info)}</div>`;
    hotItems.set(i, d); hotRowsEl.appendChild(d);
  }
}
function buildHotControls(): HTMLElement {   // country filter + search + sort + reset (persisted)
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:0 4px 10px';
  const css = 'padding:4px 7px;border-radius:7px;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.15);font-size:12px';
  const counts = new Map<string, number>();
  for (const z of hotZones) { const c = zoneInfo(z).country; if (c) counts.set(c, (counts.get(c) || 0) + 1); }
  if (hotFilter.country && !counts.has(hotFilter.country)) counts.set(hotFilter.country, 0);   // keep the persisted filter visible even with no match
  const country = document.createElement('select'); country.style.cssText = css;
  country.innerHTML = `<option value="">${t('discoverAllCountries')}</option>`
    + [...counts.keys()].sort().map(c => `<option value="${c}"${c === hotFilter.country ? ' selected' : ''}>${c} (${counts.get(c)})</option>`).join('');
  country.onchange = () => { hotFilter.country = country.value; writeHotFilter(); renderHotRows(); };
  const sort = document.createElement('select'); sort.style.cssText = css;
  sort.innerHTML = ([['count', t('discoverSortActivity')], ['name', t('discoverSortName')], ['country', t('discoverSortCountry')]] as const)
    .map(([v, l]) => `<option value="${v}"${v === hotFilter.sort ? ' selected' : ''}>${l}</option>`).join('');
  sort.onchange = () => { hotFilter.sort = sort.value as HotFilter['sort']; writeHotFilter(); renderHotRows(); };
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = t('discoverSearch'); search.value = hotFilter.q;
  search.style.cssText = css + ';flex:1;min-width:90px';
  search.oninput = () => { hotFilter.q = search.value; writeHotFilter(); renderHotRows(); };
  const reset = document.createElement('button');
  reset.textContent = '↺'; reset.title = t('discoverReset'); reset.style.cssText = css + ';cursor:pointer';
  reset.onclick = () => {
    hotFilter = { ...hotFilterDefault }; writeHotFilter();
    country.value = ''; sort.value = 'count'; search.value = '';
    renderHotRows();
  };
  wrap.append(country, search, sort, reset);
  return wrap;
}
interface ZoneInfo { code: string; name: string; country: string; flag: string; }
function nearestSpot(lat: number, lon: number): Spot | null {   // a known spot sharing this grid cell, if any
  let best: Spot | null = null, bd = 0.3;
  for (const s of allSpots()) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const d = Math.abs(s.lat - lat) + Math.abs(s.lon - lon);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
interface AfHit { name: string; code: string; }
const nameCache = new Map<string, AfHit>();   // receiver code → resolved airfield (name + canonical code)
async function resolveName(code: string): Promise<AfHit> {   // ask the OGN FlightBook for the airfield
  if (nameCache.has(code)) return nameCache.get(code)!;
  let hit: AfHit = { name: '', code };
  try {
    const list = await fetch(`${API_BASE}/api/autocomp/${encodeURIComponent(code)}`).then(r => r.json()) as Array<{ code: string; name?: string }>;
    // the receiver name (e.g. LKDK) is often a prefix of the real airfield code (LKDKH) — accept the best match
    const m = list.find(a => a.code?.toUpperCase() === code) || list.find(a => (a.code || '').toUpperCase().startsWith(code));
    if (m) hit = { name: m.name || '', code: (m.code || code).toUpperCase() };
  } catch { /* keep the raw code */ }
  nameCache.set(code, hit); return hit;
}
function zoneInfo(z: HotZone): ZoneInfo {   // resolve a name / country / flag for a hot zone
  const sp = nearestSpot(z.lat, z.lon);
  if (sp) return { code: sp.code, name: sp.name, country: sp.country, flag: isoFlag(sp.country) || codeFlag(sp.code) };
  const icao = /^[A-Z]{4}$/.test(z.label);
  const hit = icao ? nameCache.get(z.label) : undefined;
  const code = hit?.code || z.label;                 // canonical airfield code once resolved (LKDK → LKDKH)
  return { code, name: hit?.name || '', country: icao ? codeCountry(code) : '', flag: icao ? codeFlag(code) : '' };
}
function hotRowText(info: ZoneInfo): string {
  const title = info.name || info.code || '—';
  const sub = [info.name ? info.code : '', info.country].filter(Boolean).join(' · ');
  return `<b>${title}</b>${sub ? ` <span style="color:var(--mut)">· ${sub}</span>` : ''}`;
}
function patchHotRow(i: number): void {   // refresh a row + marker once its name has been resolved
  const z = hotZones[i]; if (!z) return;
  const info = zoneInfo(z);
  const nm = hotItems.get(i)?.querySelector('[data-nm]') as HTMLElement | null;
  if (nm) nm.innerHTML = hotRowText(info);
  const dot = hotDots.get(i); if (dot) dot.title = `${info.flag} ${info.name || info.code} · ${z.count}`;
}
async function enrichHotNames(): Promise<void> {   // fill in airfield names for ICAO receivers, progressively
  for (const [i, z] of hotZones.entries()) {
    if (nearestSpot(z.lat, z.lon) || !/^[A-Z]{4}$/.test(z.label) || nameCache.has(z.label)) continue;
    const hit = await resolveName(z.label);
    if (active !== 'hot') return;                  // user left the tab
    if (hit.name || hit.code !== z.label) patchHotRow(i);
  }
  if (active === 'hot' && hotFilter.sort === 'name') renderHotRows();   // reorder now that names are known
}
function pickZone(z: HotZone): void {
  close();
  const sp = nearestSpot(z.lat, z.lon);
  if (sp) { pick(sp); return; }                             // known spot → reuse its full loading path (name propagates)
  const info = zoneInfo(z);
  if (/^[A-Z]{4,}$/.test(info.code)) {                      // an airfield code (possibly resolved, e.g. LKDK → LKDKH) → load its day
    icaoEl.value = info.code; updateFbLink(); loadBtn.click();
    setPlace(info.name || info.country || info.code, info.flag);   // immediate feedback; FlightBook overrides with the real name if found
  } else { gotoSpot(z.lat, z.lon); setPlace(info.name || info.code || t('discoverHot'), info.flag); }
}

function open(): void {
  if (!overlay) build();
  active = '';                                  // start on the whole world (all spots)
  renderTabs(); renderList(); setView(null);
  overlay!.style.display = 'flex'; discoverBtn.classList.add('on');
}
function close(): void {
  if (overlay) overlay.style.display = 'none'; discoverBtn.classList.remove('on');
  if (hotTimer) { clearInterval(hotTimer); hotTimer = 0; }   // stop the age ticker while hidden
}

function pick(s: Spot): void {
  close();
  icaoEl.value = s.code;
  updateFbLink();
  if (s.checked || s.user) loadBtn.click();    // (likely) loadable → load flights (which shows the airfield name)
  else { gotoSpot(s.lat, s.lon); setPlace(s.name, isoFlag(s.country) || codeFlag(s.code)); }   // terrain-only → show the spot's name/flag
}

function select(val: string): void {
  if (val === 'hot') { active = 'hot'; renderTabs(); setView(null); void showHot(); return; }
  clearHot();
  if (dots.size === 0) rebuildDots();          // restore spot markers after leaving hot mode
  active = val; renderTabs(); renderList(); setView(val || null);
}
function renderTabs(): void {
  if (!tabsEl) return; tabsEl.innerHTML = '';
  for (const [val, label] of [['', '🌍 ' + t('discoverWorldTab')] as const, ...present().map(c => [c, contLabel(c)] as const), ['hot', '🔥 ' + t('discoverHot')] as const]) {
    const b = document.createElement('button'); b.textContent = label; b.classList.toggle('on', val === active);
    b.onclick = () => select(val);
    tabsEl.appendChild(b);
  }
}
// active === '' → world (all spots, grouped by continent); else that continent.
function renderList(): void {
  if (!listEl) return; listEl.innerHTML = ''; items.clear();
  for (const c of (active ? [active] : present())) {
    if (!active) {   // world view: a small continent divider before its spots
      const hdr = document.createElement('div'); hdr.textContent = contLabel(c);
      hdr.style.cssText = 'padding:8px 10px 2px;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px';
      listEl.appendChild(hdr);
    }
    for (const s of allSpots().filter(sp => sp.continent === c)) {
    const on = !!s.checked || !!s.user;   // clickable-to-load (built-in FlightBook, or user spot)
    const d = document.createElement('div');
    d.style.cssText = 'padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;gap:10px;align-items:baseline;' + (on ? '' : 'opacity:.55');
    d.onmouseenter = () => highlight(s.code, true);
    d.onmouseleave = () => highlight(s.code, false);
    d.onclick = () => pick(s);
    if (!on) d.title = t('discoverOffline');
    const tag = s.user ? '' : (on ? '' : ` <span style="color:var(--mut)">· ${t('discoverTerrainOnly')}</span>`);
    const cbtn = 'background:none;border:0;color:var(--mut);cursor:pointer;font-size:13px;padding:0 3px';
    const ctrl = s.user ? `<span style="margin-left:auto;display:flex;align-items:center">` +
      `<button data-edit="1" title="${t('discoverEdit')}" style="${cbtn};font-size:14px">✎</button>` +
      `<button data-mv="-1" title="${t('discoverMoveUp')}" style="${cbtn}">▲</button>` +
      `<button data-mv="1" title="${t('discoverMoveDown')}" style="${cbtn}">▼</button>` +
      `<button data-del="1" title="${t('discoverDelete')}" style="${cbtn};font-size:14px">✕</button></span>` : '';
    d.innerHTML = `<span style="font-size:18px">${flag(s.country)}</span>` +
      `<div style="flex:1"><div><b>${s.name}</b> <span style="color:var(--mut)">· ${s.code} · ${s.country}</span>${tag}</div>` +
      `<div style="color:var(--mut);font-size:12px">${s.blurb}</div></div>${ctrl}`;
    if (s.user) {
      (d.querySelector('[data-edit]') as HTMLElement).onclick = e => { e.stopPropagation(); openForm(listEl!, s); };
      d.querySelectorAll('[data-mv]').forEach(bn => (bn as HTMLElement).onclick = e => { e.stopPropagation(); moveSpot(s.code, +(bn as HTMLElement).dataset.mv!); });
      (d.querySelector('[data-del]') as HTMLElement).onclick = e => { e.stopPropagation(); deleteSpot(s.code); };
    }
    items.set(s.code, d);
    listEl.appendChild(d);
    }
  }
}
function rebuildDots(): void {
  if (!mapEl) return;
  mapEl.querySelectorAll('[data-dot]').forEach(n => n.remove()); dots.clear();
  for (const s of allSpots()) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;   // no coords → no map marker
    const on = !!s.checked || !!s.user;
    const dot = document.createElement('div'); dot.dataset.dot = s.code;
    dot.style.cssText = `position:absolute;width:10px;height:10px;border-radius:50%;transform:translate(-50%,-50%);` +
      `cursor:pointer;transition:transform .1s,left .35s,top .35s;border:1px solid rgba(0,0,0,.7);` +
      `background:${s.user ? '#4ea1ff' : on ? 'var(--accent)' : '#9aa6b2'}`;
    dot.title = `${s.name} · ${s.code}`;
    dot.onmouseenter = () => fromMap(s);
    dot.onmouseleave = () => highlight(s.code, false);
    dot.onclick = () => pick(s);
    dots.set(s.code, dot);
    mapEl.appendChild(dot);
  }
  positionDots();
}

// ---- add / import / export ----
function deleteSpot(code: string): void {
  USER = USER.filter(s => s.code !== code); saveUser();
  renderTabs(); renderList(); rebuildDots();
}
// Reorder a user spot among the user spots of its own continent (dir −1/+1).
function moveSpot(code: string, dir: number): void {
  const s = USER.find(u => u.code === code); if (!s) return;
  const sib = USER.filter(u => u.continent === s.continent), i = sib.indexOf(s), j = i + dir;
  if (j < 0 || j >= sib.length) return;
  const a = USER.indexOf(s), b = USER.indexOf(sib[j]);
  [USER[a], USER[b]] = [USER[b], USER[a]];
  saveUser(); renderList();
}
function addSpot(s: Spot): void {
  USER = USER.filter(u => u.code !== s.code); USER.push(s); saveUser();   // replace same code
  active = s.continent; renderTabs(); renderList(); rebuildDots(); highlight(s.code, true);
}
function importCsv(text: string): void {
  const spots = parseCsv(text, true);
  const codes = new Set(spots.map(s => s.code));
  USER = USER.filter(u => !codes.has(u.code)).concat(spots); saveUser();
  renderTabs(); renderList(); rebuildDots();
}
function exportCsv(): void {
  const blob = new Blob([toCsv(USER.length ? USER : allSpots())], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = USER.length ? 'my-spots.csv' : 'spots.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Very rough continent from coordinates — a sensible default the user can adjust.
function continentOf(lat: number, lon: number): string {
  if (lon <= -30) return lat >= 13 ? 'North America' : 'South America';
  if (lon > 110 && lat < 0) return 'Oceania';
  if (lon >= -20 && lon <= 52 && lat < 34 && lat > -37) return 'Africa';
  if (lon >= 30 && lat >= 5) return 'Asia';
  return 'Europe';
}

// Inline add/edit form. `edit` prefills it and, on save, replaces that spot in
// place (keeping its position). Fields are comma-free except the blurb.
function openForm(host: HTMLElement, edit?: Spot): void {
  const existing = host.querySelector('.spotform') as HTMLElement | null;
  if (existing) { existing.remove(); if (!edit) return; }   // ➕ toggles; ✎ always opens fresh
  const f = document.createElement('div'); f.className = 'spotform';
  f.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px;margin-bottom:6px;border:1px solid rgba(255,255,255,.15);border-radius:8px';
  const inp = (ph: string, w: string, v = '') => { const i = document.createElement('input'); i.placeholder = ph; i.value = v; i.style.cssText = `flex:${w};min-width:70px;padding:5px 7px`; return i; };
  const code = inp('code', '0 0 90px', edit?.code || ''), name = inp('name', '1 1 140px', edit?.name || ''), country = inp('country (ISO2)', '0 0 110px', edit?.country || '');
  const lat = inp('lat', '0 0 70px', edit ? String(edit.lat) : ''), lon = inp('lon', '0 0 70px', edit ? String(edit.lon) : ''), blurb = inp('description', '1 1 100%', edit?.blurb || '');
  const cont = document.createElement('select'); cont.style.cssText = 'flex:0 0 auto;padding:5px';
  for (const c of CONTS) { const o = document.createElement('option'); o.value = c; o.textContent = contLabel(c); cont.appendChild(o); }
  cont.value = edit?.continent || active || 'Europe';
  const save = document.createElement('button'); save.textContent = '✓'; save.className = 'on'; save.style.cssText = 'padding:5px 12px';
  save.onclick = () => {
    if (!code.value.trim() || !Number.isFinite(+lat.value) || !Number.isFinite(+lon.value)) return;
    const ns: Spot = { code: clean(code.value).toUpperCase(), name: clean(name.value) || clean(code.value), country: clean(country.value).toUpperCase().slice(0, 2), continent: cont.value, lat: +lat.value, lon: +lon.value, checked: '', blurb: clean(blurb.value), user: true };
    if (edit) {                                   // replace in place (preserve order)
      const i = USER.findIndex(u => u.code === edit.code);
      if (i >= 0) USER[i] = ns; else USER.push(ns);
      saveUser(); active = ns.continent; renderTabs(); renderList(); rebuildDots(); highlight(ns.code, true);
    } else addSpot(ns);
    f.remove();
  };
  // Typing a code queries the FlightBook and prefills name / coords / country /
  // continent (only fields the user hasn't already filled).
  let acTimer: ReturnType<typeof setTimeout> | null = null;
  code.addEventListener('input', () => {
    const q = code.value.trim().toUpperCase();
    if (acTimer) clearTimeout(acTimer);
    if (q.length < 3) return;
    acTimer = setTimeout(async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const lb: any = await fetch(`${API_BASE}/api/logbook/${encodeURIComponent(q)}/${today}`).then(r => r.json());
        const af = lb && lb.airfield;
        if (code.value.trim().toUpperCase() !== q || !af || !af.latlng) return;   // stale / not found
        lat.value = String(af.latlng[0]); lon.value = String(af.latlng[1]);
        if (!name.value.trim() && af.name) name.value = af.name;
        if (!country.value.trim()) country.value = codeCountry(q);
        cont.value = continentOf(af.latlng[0], af.latlng[1]);
        code.style.borderColor = 'var(--accent)';
      } catch { /* offline / not found — leave the fields for manual entry */ }
    }, 400);
  });
  f.append(code, name, country, cont, lat, lon, blurb, save);
  host.prepend(f); code.focus();
}

function build(): void {
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:#0c1119;display:none;flex-direction:column';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.1)';
  const h = document.createElement('b'); h.textContent = t('discoverTitle'); h.style.cssText = 'font-size:16px;flex:1';
  const mkBtn = (label: string, title: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.style.padding = '5px 10px'; b.onclick = fn; return b; };
  const addB = mkBtn('➕', t('discoverAdd'), () => openForm(listEl!));
  const impB = mkBtn('⤓', t('discoverImport'), () => fileInput!.click());
  const expB = mkBtn('⤒', t('discoverExport'), exportCsv);
  const x = mkBtn('✕', '', close);
  head.append(h, addB, impB, expB, x);

  tabsEl = document.createElement('div'); tabsEl.className = 'seg'; tabsEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px 4px';
  // Body fills the remaining height and does NOT scroll; only the list scrolls,
  // so the map stays in view. (min-height:0 lets the flex child actually shrink.)
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;gap:16px;padding:8px 16px;flex:1;min-height:0;overflow:hidden';
  mapEl = document.createElement('div');
  mapEl.style.cssText = `position:relative;flex:0 0 auto;align-self:flex-start;width:min(46vw,72vh,560px);aspect-ratio:1;border-radius:8px;` +
    `overflow:hidden;background:#0a1016;border:1px solid rgba(255,255,255,.12);cursor:pointer`;
  mapEl.title = t('discoverWorld');
  mapEl.onclick = e => { if (e.target === mapEl || e.target === bgEl) select(''); };   // click the map → back to world (tab + list too)
  bgEl = document.createElement('div');   // sharp imagery of the current view; markers sit on top at constant size
  bgEl.style.cssText = 'position:absolute;inset:0;background-position:center;background-size:100% 100%;background-repeat:no-repeat';
  mapEl.appendChild(bgEl);
  listEl = document.createElement('div');
  listEl.style.cssText = 'flex:1 1 auto;min-width:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding-right:4px';
  body.append(mapEl, listEl);
  const note = document.createElement('div');
  note.style.cssText = 'padding:8px 16px;border-top:1px solid rgba(255,255,255,.1);color:var(--mut);font-size:11px';
  note.textContent = t('discoverNote');
  fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.csv,text/csv'; fileInput.hidden = true;
  fileInput.onchange = () => { const f = fileInput!.files?.[0]; if (f) f.text().then(importCsv); fileInput!.value = ''; };

  overlay.append(head, tabsEl, body, note, fileInput);
  document.body.appendChild(overlay);
  rebuildDots();
}

discoverBtn.onclick = () => (isOpen() ? close() : open());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
