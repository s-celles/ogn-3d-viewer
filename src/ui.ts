// ============ UI controllers ============
import { S } from './state';
import { t, I18N } from './i18n';
import { API_BASE, REPO_URL, MINZ, MAXZ, PMIN, PMAX, clampv } from './config';
import {
  subjEl, viewsEl, cammodeEl, traceEl, smoothBtn, winEl, winval, playBtn, segEl,
  exoEl, exval, pitchEl, pitchval, scrub, clkEl, lglist, rose, icaoEl, acEl,
  dateEl, loadBtn, langEl, discEl, infoBtn, collapseBtn, liveBtn,
} from './dom';
import { subjectTrack, airborne, headingAt, clampCur, fmt } from './flight-math';
import { makeTerrain } from './terrain';
import { render, updateHUD } from './render';
import { loadFlights, refreshLive, statusMsg, setStatus, rebuild } from './data';
import type { Mode, Trace, Lang } from './types';

const asEl = (c: Element) => c as HTMLElement;

// ---- clock / scrubber ----
export function syncUI(): void { clkEl.textContent = S.ready ? fmt(S.cur) : '--:--'; scrub.value = String(Math.round(S.cur / S.SPAN * 1000)); }
scrub.addEventListener('input', e => { if (!S.ready) return; S.cur = +(e.target as HTMLInputElement).value / 1000 * S.SPAN; render(); syncUI(); });

// ---- view toggle ----
(['over', 'fpv', 'chase'] as Mode[]).forEach(m => {
  const b = document.createElement('button'); b.dataset.m = m; if (m === S.mode) b.classList.add('on');
  b.onclick = () => setMode(m); viewsEl.appendChild(b);
});
export function setMode(m: Mode): void {
  if ((m === 'fpv' || m === 'chase') && !S.ready) return; S.mode = m;
  [...viewsEl.children].forEach(c => asEl(c).classList.toggle('on', asEl(c).dataset.m === m));
  document.body.classList.toggle('fpv', m === 'fpv');
  document.body.classList.toggle('chase', m === 'chase');
  applyFollowClass();
  if (m === 'fpv' || m === 'chase') { const tr = subjectTrack(); if (!airborne(tr, S.cur)) S.cur = tr.rstart; } render(); syncUI();
}
export function applyFollowClass(): void {
  document.body.classList.toggle('follow', S.fpvFollow);
  document.body.classList.toggle('free', !S.fpvFollow);
  [...cammodeEl.children].forEach(c => asEl(c).classList.toggle('on', (asEl(c).dataset.f === '1') === S.fpvFollow));
}
function setFollow(v: boolean): void {
  if (!v) { const tr = subjectTrack(); S.freeCam = { bearing: headingAt(tr, clampCur(tr)), pitch: S.fpvPitch }; }
  S.fpvFollow = v; applyFollowClass(); render();
}

(['1', '0']).forEach(f => {
  const b = document.createElement('button'); b.dataset.f = f;
  if ((f === '1') === S.fpvFollow) b.classList.add('on'); b.onclick = () => setFollow(f === '1'); cammodeEl.appendChild(b);
});

subjEl.addEventListener('change', e => {
  S.subject = (e.target as HTMLSelectElement).value; const tr = subjectTrack();
  if (!airborne(tr, S.cur)) S.cur = tr.rstart; render(); syncUI();
});

// ---- trace mode ----
([['hist', 'traceHist'], ['histfut', 'traceHistFut'], ['window', 'traceWindow']] as [string, string][]).forEach(([v, key]) => {
  const o = document.createElement('option'); o.value = v; o.dataset.k = key; traceEl.appendChild(o);
});
traceEl.value = S.trace;
document.body.classList.toggle('win', S.trace === 'window'); // reflect the default (rolling window)
traceEl.addEventListener('change', e => {
  S.trace = (e.target as HTMLSelectElement).value as Trace;
  document.body.classList.toggle('win', S.trace === 'window'); render();
});
winEl.addEventListener('input', e => { S.windowMin = parseFloat((e.target as HTMLInputElement).value); winval.textContent = String(S.windowMin); render(); });

// ---- spline smoothing (default on) ----
smoothBtn.onclick = () => {
  S.spline = !S.spline;
  smoothBtn.textContent = S.spline ? t('on') : t('off'); smoothBtn.classList.toggle('on', S.spline);
  if (S.ready) rebuild(null, null, true); // regenerate the densified tracks, keep view/subject
};

// ---- play / speed ----
playBtn.onclick = () => { if (!S.ready) return; S.playing = !S.playing; playBtn.textContent = S.playing ? t('pause') : t('play'); playBtn.classList.toggle('on', S.playing); };
[1, 8, 30, 120].forEach(s => {
  const b = document.createElement('button'); b.textContent = s + '×'; if (s === S.speed) b.classList.add('on');
  b.onclick = () => { S.speed = s; [...segEl.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); }; segEl.appendChild(b);
});

// ---- exaggeration & pitch ----
exoEl.addEventListener('input', e => { S.exo = parseFloat((e.target as HTMLInputElement).value); exval.textContent = S.exo.toFixed(1) + '×'; S.terrainInst = makeTerrain(); render(); });
pitchEl.addEventListener('input', e => { S.fpvPitch = parseFloat((e.target as HTMLInputElement).value); pitchval.textContent = (S.fpvPitch >= 0 ? '+' : '') + S.fpvPitch + '°'; render(); });

(document.getElementById('reset') as HTMLButtonElement).onclick = () => {
  if (S.mode === 'over') { S.mapTarget = { ...S.INIT }; }
  else { S.fpvPitch = 6; pitchEl.value = '6'; pitchval.textContent = '+6°'; setFollow(true); }
};

// ---- legend ----
export function buildLegend(): void {
  lglist.innerHTML = '';
  S.TRACKS.forEach(tr => {
    const d = document.createElement('div'); d.className = 'lg'; const dur = Math.round((tr.rend - tr.rstart) / 60);
    d.innerHTML = `<span class="dot" style="background:rgb(${tr.color.join(',')})"></span>` +
                  `<span class="reg">${tr.reg}</span>` + `<span class="mut">${tr.label} · ${tr.maxalt} m · ${dur} ${t('min')}</span>`;
    d.style.cursor = 'pointer'; d.style.opacity = (S.solo && S.solo !== tr.reg) ? '0.45' : '1';
    d.onclick = () => {
      if (S.mode === 'fpv') { S.subject = tr.reg; subjEl.value = tr.reg; const tt = subjectTrack(); if (!airborne(tt, S.cur)) S.cur = tt.rstart; }
      else { S.solo = (S.solo === tr.reg) ? null : tr.reg; [...lglist.children].forEach((c, i) => { asEl(c).style.opacity = (S.solo && S.TRACKS[i].reg !== S.solo) ? '0.45' : '1'; }); }
      render();
    };
    lglist.appendChild(d);
  });
}

// ---- navigation ----
export function easeCamera(): void {
  const e = 0.25, d = ((S.mapTarget.bearing - S.mapVS.bearing + 540) % 360) - 180;
  S.mapVS = {
    ...S.mapVS, longitude: S.mapVS.longitude + (S.mapTarget.longitude - S.mapVS.longitude) * e,
    latitude: S.mapVS.latitude + (S.mapTarget.latitude - S.mapVS.latitude) * e, zoom: S.mapVS.zoom + (S.mapTarget.zoom - S.mapVS.zoom) * e,
    pitch: S.mapVS.pitch + (S.mapTarget.pitch - S.mapVS.pitch) * e, bearing: S.mapVS.bearing + d * e,
  };
}
export function updateCompass(): void { if (rose) rose.setAttribute('transform', 'rotate(' + (-(S.mapVS.bearing || 0)) + ' 20 20)'); }
const NAV: Record<string, () => void> = {
  rotL: () => S.mapTarget.bearing -= 30, rotR: () => S.mapTarget.bearing += 30,
  tiltUp: () => S.mapTarget.pitch = clampv(S.mapTarget.pitch + 12, PMIN, PMAX), tiltDn: () => S.mapTarget.pitch = clampv(S.mapTarget.pitch - 12, PMIN, PMAX),
  zIn: () => S.mapTarget.zoom = clampv(S.mapTarget.zoom + 0.7, MINZ, MAXZ), zOut: () => S.mapTarget.zoom = clampv(S.mapTarget.zoom - 0.7, MINZ, MAXZ),
};
Object.entries(NAV).forEach(([id, fn]) => { const el = document.getElementById(id); if (el) el.onclick = fn; });
(document.getElementById('compass') as HTMLElement).onclick = () => { S.mapTarget.bearing = 0; };

// ---- airfield autocomplete ----
let acTimer: ReturnType<typeof setTimeout> | null = null;
icaoEl.addEventListener('input', () => {
  const q = icaoEl.value.trim(); if (acTimer) clearTimeout(acTimer);
  if (q.length < 2) { acEl.classList.remove('open'); return; }
  acTimer = setTimeout(async () => {
    try {
      const list = await fetch(`${API_BASE}/api/autocomp/${encodeURIComponent(q)}`).then(r => r.json()) as Array<{ code: string; name?: string }>;
      acEl.innerHTML = ''; (list || []).slice(0, 8).forEach(a => {
        const it = document.createElement('div'); it.className = 'it';
        it.innerHTML = `<b>${a.code}</b><span>${a.name || ''}</span>`;
        it.onclick = () => { icaoEl.value = a.code; acEl.classList.remove('open'); };
        acEl.appendChild(it);
      });
      acEl.classList.toggle('open', acEl.children.length > 0);
    } catch (e) { acEl.classList.remove('open'); }
  }, 200);
});
document.addEventListener('click', e => { if (!(e.target as Element).closest('.ac')) acEl.classList.remove('open'); });
icaoEl.addEventListener('keydown', e => { if (e.key === 'Enter') { acEl.classList.remove('open'); loadBtn.click(); } });
loadBtn.onclick = () => { stopLive(); loadFlights(icaoEl.value.trim().toUpperCase(), dateEl.value); };

// ---- quick date (today / yesterday) ----
function quickDate(daysAgo: number): void {
  stopLive(); const d = new Date(); d.setDate(d.getDate() - daysAgo);
  dateEl.value = d.toISOString().slice(0, 10);
  if (icaoEl.value.trim().length >= 2) loadFlights(icaoEl.value.trim().toUpperCase(), dateEl.value);
}
(document.getElementById('todayBtn') as HTMLButtonElement).onclick = () => quickDate(0);
(document.getElementById('yestBtn') as HTMLButtonElement).onclick = () => quickDate(1);

// ---- live mode (real-time, auto-refreshing) ----
function stopLive(): void {
  S.live = false; if (S.liveTimer) clearTimeout(S.liveTimer); S.liveTimer = null;
  document.body.classList.remove('live'); liveBtn.classList.remove('on'); liveBtn.title = t('live');
  if (S.ready) { S.playing = false; playBtn.textContent = t('play'); playBtn.classList.remove('on'); }
}
async function setLive(): Promise<void> {
  if (S.live) { stopLive(); return; }
  S.live = true; document.body.classList.add('live'); liveBtn.classList.add('on'); liveBtn.title = t('liveExit');
  dateEl.value = new Date().toISOString().slice(0, 10);
  await loadFlights(icaoEl.value.trim().toUpperCase(), dateEl.value);
  if (S.live) {
    if (S.ready) statusMsg(dateEl.value, S.RAW.length); else setStatus(t('noFlights'));
    if (S.liveTimer) clearTimeout(S.liveTimer); S.liveTimer = setTimeout(refreshLive, 20000); // keep polling (waits for first flight too)
  }
}
liveBtn.onclick = setLive;

// ---- collapse panel (keeps the map visible, esp. on phones) ----
export function setCollapsed(c: boolean): void {
  document.body.classList.toggle('collapsed', c);
  collapseBtn.textContent = c ? '▸' : '▾'; collapseBtn.title = t(c ? 'expand' : 'collapse');
}
collapseBtn.onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));

// ---- language ----
(['fr', 'en'] as Lang[]).forEach(L => {
  const b = document.createElement('button'); b.textContent = L.toUpperCase(); b.dataset.l = L;
  b.onclick = () => { S.lang = L; applyI18n(); }; langEl.appendChild(b);
});
export function applyI18n(): void {
  document.documentElement.lang = S.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { (el as HTMLElement).textContent = t((el as HTMLElement).dataset.i18n!); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { (el as HTMLElement).title = t((el as HTMLElement).dataset.i18nTitle!); });
  [...langEl.children].forEach(b => asEl(b).classList.toggle('on', asEl(b).dataset.l === S.lang));
  [...viewsEl.children].forEach(b => {
    const m = asEl(b).dataset.m; asEl(b).textContent = t(m === 'over' ? 'overview' : m === 'chase' ? 'chase' : 'fpv');
  });
  [...cammodeEl.children].forEach(b => { asEl(b).textContent = t(asEl(b).dataset.f === '1' ? 'follow' : 'free'); });
  [...traceEl.options].forEach(o => { o.textContent = t(o.dataset.k!); });
  smoothBtn.textContent = S.spline ? t('on') : t('off'); smoothBtn.classList.toggle('on', S.spline);
  playBtn.textContent = S.playing ? t('pause') : t('play');
  renderDisc();
  if (S.ready) buildLegend(); if (S.mode === 'fpv') updateHUD();
}
function renderDisc(): void {
  const arr = (I18N[S.lang] && I18N[S.lang].disc) || I18N.fr.disc;
  discEl.innerHTML = '<b>' + t('disclaimerTitle') + '</b><ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>' +
    `<div style="margin-top:6px">${t('sourceCode')} : ` +
    `<a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--accent)">github.com/s-celles/ogn-3d-viewer</a></div>`;
}
infoBtn.onclick = () => { const open = discEl.style.display !== 'none'; discEl.style.display = open ? 'none' : 'block'; infoBtn.classList.toggle('on', !open); };

// ---- keyboard ----
window.addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  if (e.key === 'v' || e.key === 'V') { const order: Mode[] = ['over', 'fpv', 'chase']; setMode(order[(order.indexOf(S.mode) + 1) % 3]); }
  else if ('123'.includes(e.key)) {
    const i = +e.key - 1; if (S.TRACKS[i]) {
      S.subject = S.TRACKS[i].reg; subjEl.value = S.subject;
      const tr = subjectTrack(); if (S.mode === 'fpv' && !airborne(tr, S.cur)) S.cur = tr.rstart; render();
    }
  } else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  else if (S.mode === 'over') {
    if (e.key === 'ArrowLeft') S.mapTarget.bearing -= 15; else if (e.key === 'ArrowRight') S.mapTarget.bearing += 15;
    else if (e.key === 'ArrowUp') S.mapTarget.pitch = clampv(S.mapTarget.pitch + 8, PMIN, PMAX);
    else if (e.key === 'ArrowDown') S.mapTarget.pitch = clampv(S.mapTarget.pitch - 8, PMIN, PMAX);
    else if (e.key === '+' || e.key === '=') S.mapTarget.zoom = clampv(S.mapTarget.zoom + 0.6, MINZ, MAXZ);
    else if (e.key === '-') S.mapTarget.zoom = clampv(S.mapTarget.zoom - 0.6, MINZ, MAXZ);
  }
});
