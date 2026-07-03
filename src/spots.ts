// ============ "Discover spots": a curated tabular data package of soaring sites ============
// The dataset is a Frictionless Tabular Data Package (data/spots.csv +
// data/datapackage.json), bundled as text so it works offline. To move it to a
// separate repo later, swap the import below for a fetch of the raw CSV — nothing
// else changes. A full-screen overlay lets a newcomer pick a famous gliding site
// by continent and "fly" there; picking one just drives the normal load flow.
import { S } from './state';
import { t } from './i18n';
import { icaoEl, loadBtn, discoverBtn } from './dom';
import { gotoSpot } from './ui';
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

let overlay: HTMLElement | null = null, listEl: HTMLElement | null = null, tabsEl: HTMLElement | null = null;
let active = '';
const present = (): string[] => CONTS.filter(c => SPOTS.some(s => s.continent === c));
const isOpen = (): boolean => !!overlay && overlay.style.display === 'flex';

function open(): void {
  if (!overlay) build();
  active = present()[0] || '';
  renderTabs(); renderList();
  overlay!.style.display = 'flex'; discoverBtn.classList.add('on');
}
function close(): void { if (overlay) overlay.style.display = 'none'; discoverBtn.classList.remove('on'); }

// On FlightBook → reuse the whole load flow (leaves live, loads flights, syncs
// the URL/FlightBook link). Not on FlightBook → just fly the terrain there.
function pick(s: Spot): void {
  close();
  if (s.checked) { icaoEl.value = s.code; loadBtn.click(); }
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
  if (!listEl) return; listEl.innerHTML = '';
  for (const s of SPOTS.filter(sp => sp.continent === active)) {
    const on = !!s.checked;   // present on the OGN FlightBook
    const d = document.createElement('div');
    // Both are clickable; off-FlightBook sites are dimmed (terrain only, no traffic).
    d.style.cssText = 'padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;gap:10px;align-items:baseline;' +
      (on ? '' : 'opacity:.55');
    d.onmouseenter = () => (d.style.background = 'rgba(255,255,255,.06)');
    d.onmouseleave = () => (d.style.background = '');
    d.onclick = () => pick(s);
    if (!on) d.title = t('discoverOffline');
    d.innerHTML = `<span style="font-size:18px">${flag(s.country)}</span>` +
      `<div><div><b>${s.name}</b> <span style="color:var(--mut)">· ${s.code} · ${s.country}</span>` +
      (on ? '' : ` <span style="color:var(--mut)">· ${t('discoverTerrainOnly')}</span>`) + `</div>` +
      `<div style="color:var(--mut);font-size:12px">${s.blurb}</div></div>`;
    listEl.appendChild(d);
  }
}

function build(): void {
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(6,10,16,.86);display:none;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = e => { if (e.target === overlay) close(); };
  const card = document.createElement('div');
  card.style.cssText = 'background:#131a22;border:1px solid rgba(255,255,255,.12);border-radius:12px;max-width:720px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,.55)';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)';
  const h = document.createElement('b'); h.textContent = t('discoverTitle'); h.style.fontSize = '16px';
  const x = document.createElement('button'); x.textContent = '✕'; x.onclick = close;
  head.append(h, x);
  tabsEl = document.createElement('div'); tabsEl.className = 'seg'; tabsEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px';
  listEl = document.createElement('div'); listEl.style.cssText = 'overflow-y:auto;padding:6px 12px 14px;display:flex;flex-direction:column;gap:2px';
  const note = document.createElement('div');
  note.style.cssText = 'padding:8px 16px;border-top:1px solid rgba(255,255,255,.1);color:var(--mut);font-size:11px';
  note.textContent = t('discoverNote');
  card.append(head, tabsEl, listEl, note);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

discoverBtn.onclick = () => (isOpen() ? close() : open());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
