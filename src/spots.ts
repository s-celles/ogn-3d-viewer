// ============ "Discover spots": a curated tabular data package of soaring sites ============
// The dataset is a Frictionless Tabular Data Package (data/spots.csv +
// data/datapackage.json), bundled as text so it works offline. To move it to a
// separate repo later, swap the import below for a fetch of the raw CSV — nothing
// else changes. A full-screen overlay lets a newcomer pick a famous gliding site
// by continent (with a world locator map) and "fly" there; picking one just
// drives the normal load flow.
import { S } from './state';
import { t } from './i18n';
import { TEXTURE } from './config';
import { icaoEl, loadBtn, discoverBtn } from './dom';
import { gotoSpot, updateFbLink } from './ui';
import spotsCsv from '../data/spots.csv' with { type: 'text' };
import type { Lang } from './types';

interface Spot { code: string; name: string; country: string; continent: string; lat: number; lon: number; checked: string; blurb: string; }

// The blurb (last column) may contain commas, so keep the first 7 splits and
// rejoin the rest — enough for this dataset (only the blurb is free-form).
// `checked` is the flightbook_checked date; empty = not on the OGN FlightBook.
function parse(csv: string): Spot[] {
  const lines = csv.trim().split(/\r?\n/); lines.shift();
  return lines.filter(Boolean).map(line => {
    const p = line.split(',');
    return { code: p[0], name: p[1], country: p[2], continent: p[3], lat: +p[4], lon: +p[5], checked: p[6] || '', blurb: p.slice(7).join(',') };
  });
}
const SPOTS = parse(spotsCsv);

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
// ISO 3166-1 alpha-2 → flag emoji (regional indicator letters).
const flag = (iso: string): string => iso.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));

// World locator: the whole-world z0 imagery tile (cached by the service worker),
// with spots placed by web-mercator projection into a square of side MAP px.
const WORLD_TILE = TEXTURE.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
const MAP = 300;
const merX = (lon: number): number => (lon + 180) / 360;
const merY = (lat: number): number => {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

let overlay: HTMLElement | null = null, listEl: HTMLElement | null = null, tabsEl: HTMLElement | null = null, mapEl: HTMLElement | null = null;
let active = '';
const dots = new Map<string, HTMLElement>();     // code → map marker (all spots)
const items = new Map<string, HTMLElement>();    // code → list row (active continent only)
const present = (): string[] => CONTS.filter(c => SPOTS.some(s => s.continent === c));
const isOpen = (): boolean => !!overlay && overlay.style.display === 'flex';

// Highlight a spot on both the map and (if visible) the list at once.
function highlight(code: string, on: boolean): void {
  const d = dots.get(code);
  if (d) { d.style.transform = `translate(-50%,-50%) scale(${on ? 2 : 1})`; d.style.zIndex = on ? '3' : '1'; d.style.boxShadow = on ? '0 0 0 2px #fff' : ''; }
  const it = items.get(code);
  if (it) it.style.background = on ? 'rgba(255,255,255,.12)' : '';
  if (on && it) it.scrollIntoView({ block: 'nearest' });
}
// Hovering a map marker: switch to its continent tab if needed, then highlight.
function fromMap(s: Spot): void {
  if (s.continent !== active) { active = s.continent; renderTabs(); renderList(); }
  highlight(s.code, true);
}

function open(): void {
  if (!overlay) build();
  active = present()[0] || '';
  renderTabs(); renderList();
  overlay!.style.display = 'flex'; discoverBtn.classList.add('on');
}
function close(): void { if (overlay) overlay.style.display = 'none'; discoverBtn.classList.remove('on'); }

// Always put the code in the airfield field so the whole app (today/yesterday,
// FlightBook link, share URL…) refers to it. On FlightBook → run the normal load
// flow (which reads the field). Not on FlightBook → just fly the terrain there.
function pick(s: Spot): void {
  close();
  icaoEl.value = s.code;
  updateFbLink();
  if (s.checked) loadBtn.click();
  else gotoSpot(s.lat, s.lon);
}

function renderTabs(): void {
  if (!tabsEl) return; tabsEl.innerHTML = '';
  for (const c of present()) {
    const b = document.createElement('button'); b.textContent = contLabel(c); b.classList.toggle('on', c === active);
    b.onclick = () => { active = c; renderTabs(); renderList(); };
    tabsEl.appendChild(b);
  }
}
function renderList(): void {
  if (!listEl) return; listEl.innerHTML = ''; items.clear();
  for (const s of SPOTS.filter(sp => sp.continent === active)) {
    const on = !!s.checked;   // present on the OGN FlightBook
    const d = document.createElement('div');
    // Both are clickable; off-FlightBook sites are dimmed (terrain only, no traffic).
    d.style.cssText = 'padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;gap:10px;align-items:baseline;' +
      (on ? '' : 'opacity:.55');
    d.onmouseenter = () => highlight(s.code, true);
    d.onmouseleave = () => highlight(s.code, false);
    d.onclick = () => pick(s);
    if (!on) d.title = t('discoverOffline');
    d.innerHTML = `<span style="font-size:18px">${flag(s.country)}</span>` +
      `<div><div><b>${s.name}</b> <span style="color:var(--mut)">· ${s.code} · ${s.country}</span>` +
      (on ? '' : ` <span style="color:var(--mut)">· ${t('discoverTerrainOnly')}</span>`) + `</div>` +
      `<div style="color:var(--mut);font-size:12px">${s.blurb}</div></div>`;
    items.set(s.code, d);
    listEl.appendChild(d);
  }
}
// The map markers are built once (all spots) and reused across tab switches.
function buildDots(): void {
  if (!mapEl) return;
  for (const s of SPOTS) {
    const on = !!s.checked;
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;left:${(merX(s.lon) * MAP).toFixed(1)}px;top:${(merY(s.lat) * MAP).toFixed(1)}px;` +
      `width:9px;height:9px;border-radius:50%;transform:translate(-50%,-50%);cursor:pointer;transition:transform .1s;` +
      `border:1px solid rgba(0,0,0,.7);background:${on ? 'var(--accent)' : '#9aa6b2'}`;
    dot.title = `${s.name} · ${s.code}`;
    dot.onmouseenter = () => fromMap(s);
    dot.onmouseleave = () => highlight(s.code, false);
    dot.onclick = () => pick(s);
    dots.set(s.code, dot);
    mapEl.appendChild(dot);
  }
}

function build(): void {
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(6,10,16,.86);display:none;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = e => { if (e.target === overlay) close(); };
  const card = document.createElement('div');
  card.style.cssText = 'background:#131a22;border:1px solid rgba(255,255,255,.12);border-radius:12px;max-width:760px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,.55)';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)';
  const h = document.createElement('b'); h.textContent = t('discoverTitle'); h.style.fontSize = '16px';
  const x = document.createElement('button'); x.textContent = '✕'; x.onclick = close;
  head.append(h, x);
  tabsEl = document.createElement('div'); tabsEl.className = 'seg'; tabsEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px 4px';
  // Body: world locator map + the (per-continent) list, side by side (wraps on narrow).
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;padding:8px 16px 4px;overflow-y:auto';
  mapEl = document.createElement('div');
  mapEl.style.cssText = `position:relative;flex:0 0 auto;width:${MAP}px;height:${MAP}px;border-radius:8px;` +
    `background:#0a1016 url('${WORLD_TILE}') center/cover no-repeat;border:1px solid rgba(255,255,255,.12)`;
  listEl = document.createElement('div');
  listEl.style.cssText = `flex:1 1 260px;min-width:240px;max-height:${MAP}px;overflow-y:auto;display:flex;flex-direction:column;gap:2px`;
  body.append(mapEl, listEl);
  const note = document.createElement('div');
  note.style.cssText = 'padding:8px 16px;border-top:1px solid rgba(255,255,255,.1);color:var(--mut);font-size:11px';
  note.textContent = t('discoverNote');
  card.append(head, tabsEl, body, note);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  buildDots();
}

discoverBtn.onclick = () => (isOpen() ? close() : open());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
