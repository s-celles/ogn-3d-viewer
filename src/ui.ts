// ============ UI controllers ============
import { S, DEFAULT_SETTINGS, detectLang } from './state';
import { t, I18N } from './i18n';
import { API_BASE, REPO_URL, MINZ, MAXZ, PMIN, PMAX, CHASE, clampv, BASEMAPS, IGN_CREDIT } from './config';
import { APP_VERSION, GIT_HASH } from './version';
import {
  subjEl, viewsEl, cammodeEl, traceEl, trailFxEl, smoothBtn, compBtn, bankBtn, soundBtn, trafficModeEl, graphModeEl, graphClose, winEl, winval, playBtn, revBtn, segEl,
  exoEl, exval, groundEl, groundval, cacheEl, cacheval, acscaleEl, acscaleval, coneBtn, finesseEl, finval, safetyEl, safeval, coneRadEl, coneradval, labelsBtn, labelFieldsEl, shadowsEl, basemapEl, ignDemBtn, peaksBtn, peakDensityEl, minimapBtn, overviewHudBtn, activeOnlyBtn, clearWpBtn, attribEl, curtainBtn, attrBtn, pitchEl, pitchval, scrub, scrubMin, scrubMax, clkEl, lglist, rose, altsl, icaoEl, fblink, acEl,
  dateEl, loadBtn, langEl, discEl, infoBtn, copyBtn, shareBtn, collapseBtn, liveBtn, igcBtn, igcInput, mapDiv, prevAc, nextAc, resetSettingsBtn, afInfo,
} from './dom';
import { codeFlag } from './flags';
import qrcode from 'qrcode-generator';

const HAS_SHARE = typeof navigator !== 'undefined' && 'share' in navigator;   // Web Share API available?
import { clearStored } from './settings';
import { postCacheCap } from './sw-cache';
import { subjectTrack, airborne, isActive, headingAt, clampCur, fmt, statsFor } from './flight-math';
import { makeTerrain, clearDemCache } from './terrain';
import { render, updateHUD } from './render';
import { loadFlights, refreshLive, statusMsg, setStatus, rebuild, syncUrl, loadTrackFiles } from './data';
import { importCup, clearWaypoints, getWaypoints } from './poi';
import { TRACK_EXT } from './track-import';
import { varioAudio } from './vario-audio';
import { refreshGraphTabs } from './graphs';
import { syncGuide, openGuide } from './guide';
import type { Mode, Trace, TrailFx, ShadowMode, GraphMode, TrafficMode, Lang } from './types';

const asEl = (c: Element) => c as HTMLElement;

// ---- clock / scrubber ----
export function syncUI(): void {
  clkEl.textContent = S.ready ? fmt(S.cur) : '--:--';
  scrub.value = String(Math.round(S.cur / S.SPAN * 1000));
  // Anchor the time-of-day slider to local clock times (first → last beacon), so
  // its scale reads as the local time of day rather than abstract 0…100%.
  scrubMin.textContent = S.ready ? fmt(0).slice(0, 5) : '--:--';
  scrubMax.textContent = S.ready ? fmt(S.SPAN).slice(0, 5) : '--:--';
  updateFbLink();
}
scrub.addEventListener('input', e => { if (!S.ready) return; S.cur = +(e.target as HTMLInputElement).value / 1000 * S.SPAN; render(); syncUI(); });

// ---- view toggle ----
(['over', 'fpv', 'chase'] as Mode[]).forEach(m => {
  const b = document.createElement('button'); b.dataset.m = m; if (m === S.mode) b.classList.add('on');
  b.onclick = () => setMode(m); viewsEl.appendChild(b);
});
export function setMode(m: Mode): void {
  if ((m === 'fpv' || m === 'chase') && !S.ready) return;
  const from = S.mode; S.mode = m;
  [...viewsEl.children].forEach(c => asEl(c).classList.toggle('on', asEl(c).dataset.m === m));
  document.body.classList.toggle('fpv', m === 'fpv');
  document.body.classList.toggle('chase', m === 'chase');
  applyFollowClass();
  // Entering a follow view from the overview adopts the focused glider (the one
  // nearest the scene centre). The replay clock is left untouched on a view
  // change, so switching views never jumps the time.
  if ((m === 'fpv' || m === 'chase') && from === 'over' && S.focus) { S.subject = S.focus; subjEl.value = S.focus; }
  syncAcScale();   // reflect this view's aircraft-size setting
  render(); syncUI();
  if (S.ready && S.source !== 'file') syncUrl(icaoEl.value.trim().toUpperCase(), dateEl.value);   // keep ?view= current
}
// Fly the overview camera to a lat/lon. Used by "Discover" for sites that aren't
// on the FlightBook: no traffic to load, but you still get the site's 3D terrain.
export function gotoSpot(lat: number, lon: number): void {
  setMode('over');
  const vs = { longitude: lon, latitude: lat, zoom: 11, pitch: 55, bearing: 0, maxPitch: 85 };
  S.mapVS = { ...vs }; S.mapTarget = { ...vs };
  render();
}
// Drop any loaded flight so the scene is empty terrain — used when flying to a
// hot spot that has no loadable airfield (a named OGN receiver).
export function clearScene(): void {
  stopLive();
  S.RAW = []; S.TRACKS = []; S.ready = false; S.AF = null; S.CURAF = null;
  S.solo = null; S.subject = null; S.focus = null; S.focusLock = null;
  icaoEl.value = ''; updateFbLink();
  buildLegend();   // empties the legend list
  render();
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

// Cycle the followed aircraft (keyboard j/k, or the HUD ◀/▶ buttons for touch).
// Doesn't touch the replay clock — just switches which glider is followed.
const uniqueRegs = (): string[] => [...new Set(S.TRACKS.map(tr => tr.reg))];
// The registrations you can cycle/pick. With the "active only" filter on, keep
// just the airborne ones (but fall back to all if none are, so you're never stuck).
const cycleRegs = (): string[] => {
  const regs = uniqueRegs();
  if (!S.activeOnly) return regs;
  const active = regs.filter(r => S.TRACKS.some(tr => tr.reg === r && isActive(tr)));
  return active.length ? active : regs;
};
function cycleSubject(dir: number): void {
  const regs = cycleRegs(); if (!regs.length) return;
  // In the overview, J/K and the HUD ◀/▶ cycle the focused glider (pinned via
  // focusLock); in cockpit/chase they cycle the followed subject.
  if (S.mode === 'over') {
    const i = regs.indexOf((S.focusLock || S.focus) ?? '');
    const n = i < 0 ? (dir > 0 ? 0 : regs.length - 1) : (i + dir + regs.length) % regs.length;
    S.focusLock = regs[n]; S.focus = regs[n]; render(); syncUI(); return;
  }
  const i = regs.indexOf(S.subject!);
  const n = i < 0 ? (dir > 0 ? 0 : regs.length - 1) : (i + dir + regs.length) % regs.length;
  S.subject = regs[n]; subjEl.value = S.subject; render(); syncUI();
}
prevAc.onclick = () => cycleSubject(-1);
nextAc.onclick = () => cycleSubject(1);

// ---- trace mode ----
([['off', 'traceOff'], ['hist', 'traceHist'], ['histfut', 'traceHistFut'], ['window', 'traceWindow']] as [string, string][]).forEach(([v, key]) => {
  const o = document.createElement('option'); o.value = v; o.dataset.k = key; traceEl.appendChild(o);
});
traceEl.value = S.trace;
document.body.classList.toggle('win', S.trace === 'window'); // reflect the default (rolling window)
traceEl.addEventListener('change', e => {
  S.trace = (e.target as HTMLSelectElement).value as Trace;
  document.body.classList.toggle('win', S.trace === 'window'); render();
});
winEl.addEventListener('input', e => { S.windowMin = parseFloat((e.target as HTMLInputElement).value); winval.textContent = String(S.windowMin); render(); });

// ---- trail visual effect (basic → neon → contrail → bloom) ----
([['basic', 'fxBasic'], ['glow', 'fxGlow'], ['contrail', 'fxContrail'], ['bloom', 'fxBloom']] as [string, string][])
  .forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.dataset.k = k; trailFxEl.appendChild(o); });
trailFxEl.value = S.trailFx;
trailFxEl.addEventListener('change', e => { S.trailFx = (e.target as HTMLSelectElement).value as TrailFx; render(); });

// ---- spline smoothing (default on) ----
smoothBtn.onclick = () => {
  S.spline = !S.spline;
  smoothBtn.textContent = S.spline ? t('on') : t('off'); smoothBtn.classList.toggle('on', S.spline);
  if (S.ready) rebuild(null, null, true); // regenerate the densified tracks, keep view/subject
};

// ---- compensated (total-energy) vario, default on ----
compBtn.onclick = () => {
  S.compensated = !S.compensated;
  compBtn.textContent = S.compensated ? t('on') : t('off'); compBtn.classList.toggle('on', S.compensated);
  render(); // HUD vario refreshes (cockpit / chase)
};

// ---- horizon banking in cockpit follow mode, default on ----
bankBtn.onclick = () => {
  S.bank = !S.bank;
  bankBtn.textContent = S.bank ? t('on') : t('off'); bankBtn.classList.toggle('on', S.bank);
  render();
};

// ---- audio variometer, default on ----
soundBtn.onclick = () => {
  S.sound = !S.sound;
  soundBtn.textContent = S.sound ? t('on') : t('off'); soundBtn.classList.toggle('on', S.sound);
  if (S.sound) varioAudio.resume(); // this click is the user gesture that unlocks audio
  render();
};
// ---- traffic-awareness display: off / radar / directional ----
([['off', 'trafficOff'], ['radar', 'trafficRadar'], ['directional', 'trafficDir']] as [string, string][])
  .forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.dataset.k = k; trafficModeEl.appendChild(o); });
trafficModeEl.value = S.trafficMode;
trafficModeEl.addEventListener('change', e => {
  S.trafficMode = (e.target as HTMLSelectElement).value as TrafficMode;
  document.body.classList.toggle('traffic', S.trafficMode !== 'off'); render();
});
// ---- graphs drawer (off / history / history+future / rolling) ----
([['off', 'graphsOff'], ['hist', 'traceHist'], ['histfut', 'traceHistFut'], ['rolling', 'traceWindow']] as [string, string][])
  .forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.dataset.k = k; graphModeEl.appendChild(o); });
graphModeEl.value = S.graphMode;
const applyGraphMode = () => { document.body.classList.toggle('graphs', S.graphMode !== 'off'); render(); };
graphModeEl.addEventListener('change', e => { S.graphMode = (e.target as HTMLSelectElement).value as GraphMode; applyGraphMode(); });
graphClose.onclick = () => { S.graphMode = 'off'; graphModeEl.value = 'off'; applyGraphMode(); };
// Browsers block audio until a user gesture. Mobile is strict (a context made
// outside a gesture stays suspended, and one touch may not be enough), so retry
// on several gesture types until it's actually running, then stop listening.
const AUDIO_EVENTS = ['pointerdown', 'touchstart', 'click', 'keydown'];
const unlockAudio = () => {
  if (S.sound) varioAudio.resume();
  if (varioAudio.running || !S.sound) AUDIO_EVENTS.forEach(ev => window.removeEventListener(ev, unlockAudio));
};
AUDIO_EVENTS.forEach(ev => window.addEventListener(ev, unlockAudio));

// ---- play / speed (forward + reverse, slow-motion presets + a custom field) ----
export function syncTransport(): void {   // reflect playing state + direction on the two icon buttons
  const fwd = S.playing && S.dir > 0, back = S.playing && S.dir < 0;
  playBtn.textContent = fwd ? '⏸' : '▶'; playBtn.title = fwd ? t('pause') : t('play'); playBtn.classList.toggle('on', fwd);
  revBtn.textContent = back ? '⏸' : '◀'; revBtn.classList.toggle('on', back);
}
playBtn.onclick = () => { if (!S.ready) return; if (S.playing && S.dir > 0) S.playing = false; else { S.playing = true; S.dir = 1; } syncTransport(); };
revBtn.onclick  = () => { if (!S.ready) return; if (S.playing && S.dir < 0) S.playing = false; else { S.playing = true; S.dir = -1; } syncTransport(); };
const speedCustom = document.createElement('input');
export function syncSpeedUI(): void {   // highlight the matching preset, else show the value in the custom field
  let matched = false;
  segEl.querySelectorAll('button').forEach(b => { const on = b.textContent === S.speed + '×'; b.classList.toggle('on', on); if (on) matched = true; });
  if (document.activeElement !== speedCustom) speedCustom.value = matched ? '' : String(S.speed);
}
[0.25, 1, 4, 8, 30].forEach(s => {
  const b = document.createElement('button'); b.textContent = s + '×';
  b.onclick = () => { S.speed = s; syncSpeedUI(); };
  segEl.appendChild(b);
});
speedCustom.type = 'number'; speedCustom.min = '0.05'; speedCustom.step = '0.25'; speedCustom.placeholder = '×'; speedCustom.title = t('speedCustom');
speedCustom.style.cssText = 'width:58px;padding:4px 6px;border-radius:7px;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.15);font-size:12px';
speedCustom.oninput = () => { const v = parseFloat(speedCustom.value); if (v > 0 && Number.isFinite(v)) { S.speed = v; segEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === S.speed + '×')); } };
segEl.appendChild(speedCustom);
syncSpeedUI();

// ---- exaggeration & pitch ----
exoEl.addEventListener('input', e => { S.exo = parseFloat((e.target as HTMLInputElement).value); exval.textContent = S.exo.toFixed(1) + '×'; S.terrainInst = makeTerrain(); render(); });

// ---- ground resolution (imagery/terrain detail ceiling) ----
groundEl.addEventListener('input', e => { S.groundZoom = parseInt((e.target as HTMLInputElement).value, 10); groundval.textContent = 'z' + S.groundZoom; S.terrainInst = makeTerrain(); render(); });

// ---- cache size (multiplier on the device-default RAM + disk caches) ----
cacheEl.addEventListener('input', e => {
  S.cacheScale = parseFloat((e.target as HTMLInputElement).value); cacheval.textContent = '×' + S.cacheScale;
  S.terrainInst = makeTerrain();   // apply the new deck (RAM) cache size
  postCacheCap();                  // apply the new disk cap to the service worker
  render();
});

// ---- aircraft size (per view, edits the current view's mesh scale) ----
const fmtScale = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '×';
export function syncAcScale(): void { const v = S.modelScale[S.mode]; acscaleEl.value = String(v); acscaleval.textContent = fmtScale(v); }
acscaleEl.addEventListener('input', e => {
  S.modelScale[S.mode] = parseFloat((e.target as HTMLInputElement).value);
  acscaleval.textContent = fmtScale(S.modelScale[S.mode]); render();
});

// Reflect every persisted setting onto its control (values, labels, on-states,
// body classes). Run at startup after settings are loaded, and after a reset.
// Button *texts* (Activé/Désactivé) are set by applyI18n, called alongside this.
export function syncControls(): void {
  traceEl.value = S.trace; trailFxEl.value = S.trailFx;
  trafficModeEl.value = S.trafficMode; graphModeEl.value = S.graphMode;
  shadowsEl.value = S.shadowMode; langEl.value = langValue();
  if (BASEMAPS[S.basemap]) basemapEl.value = S.basemap;
  peakDensityEl.value = String(S.peakDensity); document.body.classList.toggle('peaks', S.showPeaks);
  document.body.classList.toggle('minimap', S.minimap);
  minimapBtn.textContent = S.minimap ? t('on') : t('off'); minimapBtn.classList.toggle('on', S.minimap);
  document.body.classList.toggle('ovhud', S.overviewHud);
  overviewHudBtn.textContent = S.overviewHud ? t('on') : t('off'); overviewHudBtn.classList.toggle('on', S.overviewHud);
  activeOnlyBtn.textContent = S.activeOnly ? t('on') : t('off'); activeOnlyBtn.classList.toggle('on', S.activeOnly);
  document.body.classList.toggle('haswp', getWaypoints().length > 0);
  exoEl.value = String(S.exo); exval.textContent = S.exo.toFixed(1) + '×';
  groundEl.value = String(S.groundZoom); groundval.textContent = 'z' + S.groundZoom;
  cacheEl.value = String(S.cacheScale); cacheval.textContent = '×' + S.cacheScale;
  winEl.value = String(S.windowMin); winval.textContent = String(S.windowMin);
  finesseEl.value = String(S.glideRatio); finval.textContent = String(S.glideRatio);
  safetyEl.value = String(S.safetyHeight); safeval.textContent = String(S.safetyHeight);
  coneRadEl.value = String(S.coneRadiusKm); coneradval.textContent = String(S.coneRadiusKm);
  pitchEl.value = String(S.fpvPitch); pitchval.textContent = (S.fpvPitch >= 0 ? '+' : '') + S.fpvPitch + '°';
  syncAcScale();
  syncSpeedUI();
  smoothBtn.classList.toggle('on', S.spline); compBtn.classList.toggle('on', S.compensated);
  bankBtn.classList.toggle('on', S.bank); soundBtn.classList.toggle('on', S.sound);
  coneBtn.classList.toggle('on', S.glideCone); labelsBtn.classList.toggle('on', S.labels);
  curtainBtn.classList.toggle('on', S.altCurtain); attrBtn.classList.toggle('on', S.showAttribution);
  document.body.classList.toggle('noattr', !S.showAttribution);
  [...labelFieldsEl.children].forEach(b => asEl(b).classList.toggle('on', !!S.labelFields[asEl(b).dataset.f as keyof typeof S.labelFields]));
  document.body.classList.toggle('win', S.trace === 'window');
  document.body.classList.toggle('traffic', S.trafficMode !== 'off');
  document.body.classList.toggle('graphs', S.graphMode !== 'off');
  document.body.classList.toggle('cone', S.glideCone);
  document.body.classList.toggle('labels', S.labels);
}

// Restore the built-in defaults and forget the saved settings. Re-syncs the UI;
// rebuilds the tracks if loaded (spline/window may have changed).
resetSettingsBtn.onclick = () => {
  const d = DEFAULT_SETTINGS as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    const v = d[k]; (S as any)[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  }
  clearStored();
  S.terrainInst = makeTerrain();   // exaggeration / ground resolution / cache size may have changed
  postCacheCap();                  // restore the default disk cap in the service worker
  syncControls(); applyI18n();
  if (S.ready) rebuild(null, null, true); else render();
};

// ---- glide cone (off by default) ----
coneBtn.onclick = () => {
  S.glideCone = !S.glideCone;
  coneBtn.textContent = S.glideCone ? t('on') : t('off'); coneBtn.classList.toggle('on', S.glideCone);
  document.body.classList.toggle('cone', S.glideCone); render();
};
finesseEl.addEventListener('input', e => { S.glideRatio = parseFloat((e.target as HTMLInputElement).value); finval.textContent = String(S.glideRatio); render(); });
safetyEl.addEventListener('input', e => { S.safetyHeight = parseFloat((e.target as HTMLInputElement).value); safeval.textContent = String(S.safetyHeight); render(); });
coneRadEl.addEventListener('input', e => { S.coneRadiusKm = parseFloat((e.target as HTMLInputElement).value); coneradval.textContent = String(S.coneRadiusKm); render(); });

// ---- per-aircraft labels (off by default) + selectable fields ----
const LABEL_FIELDS: [keyof typeof S.labelFields, string][] =
  [['reg', 'lblReg'], ['alt', 'lblAlt'], ['speed', 'lblSpeed'], ['vario', 'lblVario'], ['hdg', 'lblHdg']];
labelsBtn.onclick = () => {
  S.labels = !S.labels;
  labelsBtn.textContent = S.labels ? t('on') : t('off'); labelsBtn.classList.toggle('on', S.labels);
  document.body.classList.toggle('labels', S.labels); render();
};
LABEL_FIELDS.forEach(([f, k]) => {
  const b = document.createElement('button'); b.dataset.f = f; b.dataset.k = k;
  b.textContent = t(k); b.classList.toggle('on', S.labelFields[f]);
  b.onclick = () => { S.labelFields[f] = !S.labelFields[f]; b.classList.toggle('on', S.labelFields[f]); render(); };
  labelFieldsEl.appendChild(b);
});

// ---- ground shadows: off / vertical (nadir) / sun-cast ----
([['off', 'shadowOff'], ['nadir', 'shadowNadir'], ['sun', 'shadowSun']] as [string, string][])
  .forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.dataset.k = k; shadowsEl.appendChild(o); });
shadowsEl.value = S.shadowMode;
shadowsEl.addEventListener('change', e => { S.shadowMode = (e.target as HTMLSelectElement).value as ShadowMode; render(); });
// ---- base map draped over the terrain (Esri / OpenTopoMap / OpenStreetMap) ----
for (const [k, bm] of Object.entries(BASEMAPS)) { const o = document.createElement('option'); o.value = k; o.textContent = bm.label; basemapEl.appendChild(o); }
if (!BASEMAPS[S.basemap]) S.basemap = 'esri';
basemapEl.value = S.basemap;
basemapEl.addEventListener('change', e => {
  S.basemap = (e.target as HTMLSelectElement).value;
  S.terrainInst = makeTerrain(); updateMapCredit(); render();
});
// ---- finer IGN RGE ALTI DEM over France (falls back to Terrarium elsewhere) ----
ignDemBtn.onclick = () => {
  S.ignDem = !S.ignDem;
  ignDemBtn.textContent = S.ignDem ? t('on') : t('off'); ignDemBtn.classList.toggle('on', S.ignDem);
  clearDemCache(); S.terrainInst = makeTerrain(); updateMapCredit(); render();
};
// ---- named summits (OSM) + waypoints, with a density slider ----
peaksBtn.onclick = () => {
  S.showPeaks = !S.showPeaks;
  peaksBtn.textContent = S.showPeaks ? t('on') : t('off'); peaksBtn.classList.toggle('on', S.showPeaks);
  document.body.classList.toggle('peaks', S.showPeaks);
  updateMapCredit(); render();   // render() triggers the view-driven summit fetch
};
peakDensityEl.addEventListener('input', e => { S.peakDensity = parseFloat((e.target as HTMLInputElement).value); render(); });
// ---- inset 2D minimap toggle ----
minimapBtn.onclick = () => {
  S.minimap = !S.minimap;
  minimapBtn.textContent = S.minimap ? t('on') : t('off'); minimapBtn.classList.toggle('on', S.minimap);
  document.body.classList.toggle('minimap', S.minimap); render();
};
// ---- HUD in the overview (focused glider), opt-in ----
overviewHudBtn.onclick = () => {
  S.overviewHud = !S.overviewHud;
  overviewHudBtn.textContent = S.overviewHud ? t('on') : t('off'); overviewHudBtn.classList.toggle('on', S.overviewHud);
  document.body.classList.toggle('ovhud', S.overviewHud); render();
};
// ---- show/cycle only airborne gliders, opt-in ----
activeOnlyBtn.onclick = () => {
  S.activeOnly = !S.activeOnly;
  activeOnlyBtn.textContent = S.activeOnly ? t('on') : t('off'); activeOnlyBtn.classList.toggle('on', S.activeOnly);
  render();
};
// Remove all imported .cup waypoints (summits from OSM are unaffected).
clearWpBtn.onclick = () => {
  clearWaypoints(); document.body.classList.remove('haswp');
  render(); setStatus('0 ' + t('peakWaypoints'));
};
// Imagery credit (per base map) + shared terrain credit, kept in sync in BOTH
// the on-map overlay and the ⓘ info panel (the latter isn't rebuilt on a
// base-map switch, so update its copy directly).
function mapCreditHtml(): string {
  const ign = S.ignDem ? ` · ${IGN_CREDIT}` : '';   // IGN RGE ALTI / BD ORTHO used over France
  const osm = S.showPeaks ? ` · ${t('peaks')} © <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap</a>` : '';
  return `${(BASEMAPS[S.basemap] || BASEMAPS.esri).credit}${ign}${osm} · ${t('terrainCredit')}`;
}
export function updateMapCredit(): void {
  const html = mapCreditHtml();
  attribEl.innerHTML = html;
  const mc = discEl.querySelector('.mapcredit'); if (mc) mc.innerHTML = html;
}
curtainBtn.onclick = () => {
  S.altCurtain = !S.altCurtain;
  curtainBtn.textContent = S.altCurtain ? t('on') : t('off'); curtainBtn.classList.toggle('on', S.altCurtain); render();
};
// ---- cartographic attribution overlay (on by default) ----
attrBtn.onclick = () => {
  S.showAttribution = !S.showAttribution;
  attrBtn.textContent = S.showAttribution ? t('on') : t('off'); attrBtn.classList.toggle('on', S.showAttribution);
  document.body.classList.toggle('noattr', !S.showAttribution); render();
};
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
    const s = statsFor(tr);
    const stats = `↔ ${s.distKm.toFixed(0)} km · ${t('gain')} ${s.gain.toFixed(0)} m · ` +
                  `${s.avgKmh.toFixed(0)}→${s.maxKmh.toFixed(0)} km/h · vz ${s.maxClimb.toFixed(1)} m/s`;
    d.innerHTML = `<span class="dot" style="background:rgb(${tr.color.join(',')})"></span>` +
                  `<div class="lgtext">` +
                    `<div class="lgtop"><span class="loc"></span><span class="reg">${tr.reg}</span><span class="mut">${tr.label} · ${tr.maxalt} m · ${dur} ${t('min')}</span></div>` +
                    `<div class="mut2">${stats}</div>` +
                  `</div>`;
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
// Viewpoint-altitude slider ⇄ camera pitch. At fixed zoom (distance) and a fixed
// look-at point, raising the eye = orbiting toward overhead = a SMALLER pitch
// (pitch 0 is straight-down). The slider runs max→min top→bottom (CSS direction
// rtl), so the fill grows from the bottom; we map pitch = max−value so the TOP
// (max value) = overhead (pitch 0) and the bottom = ground-level view. Only the
// height changes; the observed point and the zoom do not.
const PALT = (p: number): number => (PMIN + PMAX) - p;    // self-inverse: PALT(PALT(p)) === p
if (altsl) {
  altsl.min = String(PMIN); altsl.max = String(PMAX);
  altsl.addEventListener('input', () => { S.mapTarget.pitch = clampv(PALT(+altsl.value), PMIN, PMAX); });
}

export function updateCompass(): void {
  if (rose) rose.setAttribute('transform', 'rotate(' + (-(S.mapVS.bearing || 0)) + ' 20 20)');
  // Keep the altitude slider in sync with drag/tilt-button pitch, unless dragged.
  if (altsl && document.activeElement !== altsl) altsl.value = String(PALT(S.mapVS.pitch));
}
const NAV: Record<string, () => void> = {
  rotL: () => S.mapTarget.bearing -= 30, rotR: () => S.mapTarget.bearing += 30,
  tiltUp: () => S.mapTarget.pitch = clampv(S.mapTarget.pitch + 12, PMIN, PMAX), tiltDn: () => S.mapTarget.pitch = clampv(S.mapTarget.pitch - 12, PMIN, PMAX),
  zIn: () => S.mapTarget.zoom = clampv(S.mapTarget.zoom + 0.7, MINZ, MAXZ), zOut: () => S.mapTarget.zoom = clampv(S.mapTarget.zoom - 0.7, MINZ, MAXZ),
};
Object.entries(NAV).forEach(([id, fn]) => { const el = document.getElementById(id); if (el) el.onclick = fn; });
(document.getElementById('compass') as HTMLElement).onclick = () => { S.mapTarget.bearing = 0; };

// Chase-cam controls: move the viewpoint relative to the aircraft. The render
// loop reads S.chase every frame, so changes show immediately.
const CHASE_NAV: Record<string, () => void> = {
  cOrbitL: () => S.chase.az -= CHASE.azStep, cOrbitR: () => S.chase.az += CHASE.azStep,
  cElUp: () => S.chase.el = clampv(S.chase.el + CHASE.elStep, CHASE.elMin, CHASE.elMax),
  cElDn: () => S.chase.el = clampv(S.chase.el - CHASE.elStep, CHASE.elMin, CHASE.elMax),
  cNear: () => S.chase.dist = clampv(S.chase.dist / CHASE.distStep, CHASE.distMin, CHASE.distMax),
  cFar: () => S.chase.dist = clampv(S.chase.dist * CHASE.distStep, CHASE.distMin, CHASE.distMax),
  cReset: () => { S.chase = { az: CHASE.az0, el: CHASE.el0, dist: CHASE.dist0 }; },
};
Object.entries(CHASE_NAV).forEach(([id, fn]) => { const el = document.getElementById(id); if (el) el.onclick = fn; });

// ---- airfield autocomplete ----
let acTimer: ReturnType<typeof setTimeout> | null = null;
icaoEl.addEventListener('input', () => {
  updateFbLink();
  const q = icaoEl.value.trim(); if (acTimer) clearTimeout(acTimer);
  if (q.length < 2) { acEl.classList.remove('open'); return; }
  acTimer = setTimeout(async () => {
    try {
      const list = await fetch(`${API_BASE}/api/autocomp/${encodeURIComponent(q)}`).then(r => r.json()) as Array<{ code: string; name?: string }>;
      acEl.innerHTML = ''; (list || []).slice(0, 8).forEach(a => {
        const it = document.createElement('div'); it.className = 'it';
        it.innerHTML = `<b>${a.code}</b><span>${a.name || ''}</span>`;
        it.onclick = () => { icaoEl.value = a.code; acEl.classList.remove('open'); updateFbLink(); };
        acEl.appendChild(it);
      });
      acEl.classList.toggle('open', acEl.children.length > 0);
    } catch (e) { acEl.classList.remove('open'); }
  }, 200);
});
document.addEventListener('click', e => { if (!(e.target as Element).closest('.ac')) acEl.classList.remove('open'); });
icaoEl.addEventListener('keydown', e => { if (e.key === 'Enter') { acEl.classList.remove('open'); loadBtn.click(); } });
dateEl.addEventListener('input', updateFbLink);
loadBtn.onclick = () => { setPlace(null); stopLive(); loadFlights(icaoEl.value.trim().toUpperCase(), dateEl.value); };

// ---- quick date (today / yesterday) ----
function quickDate(daysAgo: number): void {
  setPlace(null); stopLive(); const d = new Date(); d.setDate(d.getDate() - daysAgo);
  dateEl.value = d.toISOString().slice(0, 10);
  if (icaoEl.value.trim().length >= 2) loadFlights(icaoEl.value.trim().toUpperCase(), dateEl.value);
}
(document.getElementById('todayBtn') as HTMLButtonElement).onclick = () => quickDate(0);
(document.getElementById('yestBtn') as HTMLButtonElement).onclick = () => quickDate(1);

// ---- live mode (real-time, auto-refreshing) ----
function stopLive(): void {
  const wasLive = S.live;
  S.live = false; if (S.liveTimer) clearTimeout(S.liveTimer); S.liveTimer = null;
  document.body.classList.remove('live'); liveBtn.classList.remove('on'); liveBtn.title = t('live');
  if (S.ready) { S.playing = false; S.dir = 1; syncTransport(); }
  // Reflect the switch back to replay in the URL (keeps a shared link accurate).
  if (wasLive && icaoEl.value.trim()) syncUrl(icaoEl.value.trim().toUpperCase(), dateEl.value);
}
export async function setLive(): Promise<void> {
  if (S.live) { stopLive(); return; }
  setPlace(null);
  S.live = true; document.body.classList.add('live'); liveBtn.classList.add('on'); liveBtn.title = t('liveExit');
  dateEl.value = new Date().toISOString().slice(0, 10);
  await loadFlights(icaoEl.value.trim().toUpperCase(), dateEl.value);
  if (S.live) {
    if (S.ready) statusMsg(dateEl.value, S.RAW.length); else setStatus(t('noFlights'));
    if (S.liveTimer) clearTimeout(S.liveTimer); S.liveTimer = setTimeout(refreshLive, 20000); // keep polling (waits for first flight too)
  }
}
liveBtn.onclick = setLive;

// ---- local IGC files (offline replay) ----
// Picker replaces the scene; drag-drop onto the map adds to it. Either way we
// leave any live/OGN session first.
// Import: IGC/GPX/KML tracks go to the replay; a .cup file adds its waypoints
// (SeeYou) as POIs. A file set may contain both.
async function importFiles(files: FileList | File[], replace: boolean): Promise<void> {
  const arr = [...files], cups = arr.filter(f => /\.cup$/i.test(f.name));
  if (cups.length) {
    let added = 0;
    clearWaypoints();   // a .cup import replaces the previous waypoint set (no duplicates on re-import)
    for (const f of cups) { try { added += importCup(await f.text()); } catch { /* bad file */ } }
    if (added && !S.showPeaks) { S.showPeaks = true; document.body.classList.add('peaks'); peaksBtn.textContent = t('on'); peaksBtn.classList.add('on'); }
    document.body.classList.toggle('haswp', getWaypoints().length > 0);
    render(); setStatus(`${added} ${t('peakWaypoints')}`);
  }
  if (arr.some(f => TRACK_EXT.test(f.name))) { stopLive(); loadTrackFiles(arr, replace); }
}
igcBtn.onclick = () => igcInput.click();
igcInput.addEventListener('change', e => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files.length) importFiles(files, false);
  igcInput.value = ''; // allow re-selecting the same file
});
['dragenter', 'dragover'].forEach(ev => mapDiv.addEventListener(ev, e => {
  if ((e as DragEvent).dataTransfer?.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dragover'); }
}));
['dragleave', 'drop'].forEach(ev => mapDiv.addEventListener(ev, e => {
  if (ev === 'dragleave' && e.target !== mapDiv) return;
  document.body.classList.remove('dragover');
}));
mapDiv.addEventListener('drop', e => {
  const files = (e as DragEvent).dataTransfer?.files;
  if (files && files.length) { e.preventDefault(); importFiles(files, true); }
});

// ---- collapse panel (keeps the map visible, esp. on phones) ----
export function setCollapsed(c: boolean): void {
  document.body.classList.toggle('collapsed', c);
  collapseBtn.textContent = c ? '▸' : '▾'; collapseBtn.title = t(c ? 'expand' : 'collapse');
}
collapseBtn.onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));

// ---- language (dropdown, with an Auto = follow-browser option) ----
{ const o = document.createElement('option'); o.value = 'auto'; o.dataset.k = 'langAuto'; langEl.appendChild(o); }
(['fr', 'en', 'de', 'es', 'it'] as Lang[]).forEach(L => {
  const o = document.createElement('option'); o.value = L; o.textContent = L.toUpperCase(); langEl.appendChild(o);
});
const langValue = (): string => S.langAuto ? 'auto' : S.lang;
langEl.value = langValue();
/** Switch UI language ('auto' follows the browser). Re-applies all translations. */
export function setLang(v: string): void {
  if (v === 'auto') { S.langAuto = true; S.lang = detectLang(); } else { S.langAuto = false; S.lang = v as Lang; }
  applyI18n();
}
export const langCurrent = (): string => langValue();
langEl.addEventListener('change', e => setLang((e.target as HTMLSelectElement).value));
export function applyI18n(): void {
  document.documentElement.lang = S.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { (el as HTMLElement).textContent = t((el as HTMLElement).dataset.i18n!); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { (el as HTMLElement).innerHTML = t((el as HTMLElement).dataset.i18nHtml!); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { (el as HTMLElement).title = t((el as HTMLElement).dataset.i18nTitle!); });
  const autoOpt = langEl.querySelector('option[value="auto"]'); if (autoOpt) autoOpt.textContent = t('langAuto');
  langEl.value = langValue();
  [...viewsEl.children].forEach(b => {
    const m = asEl(b).dataset.m; asEl(b).textContent = t(m === 'over' ? 'overview' : m === 'chase' ? 'chase' : 'fpv');
  });
  [...cammodeEl.children].forEach(b => { asEl(b).textContent = t(asEl(b).dataset.f === '1' ? 'follow' : 'free'); });
  [...traceEl.options].forEach(o => { o.textContent = t(o.dataset.k!); });
  [...trailFxEl.options].forEach(o => { o.textContent = t(o.dataset.k!); });
  smoothBtn.textContent = S.spline ? t('on') : t('off'); smoothBtn.classList.toggle('on', S.spline);
  compBtn.textContent = S.compensated ? t('on') : t('off'); compBtn.classList.toggle('on', S.compensated);
  bankBtn.textContent = S.bank ? t('on') : t('off'); bankBtn.classList.toggle('on', S.bank);
  soundBtn.textContent = S.sound ? t('on') : t('off'); soundBtn.classList.toggle('on', S.sound);
  coneBtn.textContent = S.glideCone ? t('on') : t('off'); coneBtn.classList.toggle('on', S.glideCone);
  labelsBtn.textContent = S.labels ? t('on') : t('off'); labelsBtn.classList.toggle('on', S.labels);
  [...labelFieldsEl.children].forEach(b => { asEl(b).textContent = t(asEl(b).dataset.k!); });
  [...shadowsEl.options].forEach(o => { o.textContent = t(o.dataset.k!); });
  curtainBtn.textContent = S.altCurtain ? t('on') : t('off'); curtainBtn.classList.toggle('on', S.altCurtain);
  ignDemBtn.textContent = S.ignDem ? t('on') : t('off'); ignDemBtn.classList.toggle('on', S.ignDem);
  peaksBtn.textContent = S.showPeaks ? t('on') : t('off'); peaksBtn.classList.toggle('on', S.showPeaks);
  attrBtn.textContent = S.showAttribution ? t('on') : t('off'); attrBtn.classList.toggle('on', S.showAttribution);
  [...trafficModeEl.options].forEach(o => o.textContent = t(o.dataset.k!));
  document.body.classList.toggle('traffic', S.trafficMode !== 'off');
  [...graphModeEl.options].forEach(o => o.textContent = t(o.dataset.k!));
  refreshGraphTabs();
  syncTransport();
  updateMapCredit();
  renderDisc();
  syncGuide();
  if (S.ready) buildLegend(); if (S.mode === 'fpv') updateHUD();
}
function renderDisc(): void {
  const arr = (I18N[S.lang] && I18N[S.lang].disc) || I18N.en.disc;
  const commit = GIT_HASH === 'dev'
    ? GIT_HASH
    : `<a href="${REPO_URL}/commit/${GIT_HASH}" target="_blank" rel="noopener" style="color:var(--accent)">${GIT_HASH}</a>`;
  discEl.innerHTML = `<button id="discGuideBtn" style="margin:0 0 10px;padding:6px 12px">📖 ${t('guide')}</button>` +
    '<b>' + t('disclaimerTitle') + '</b><ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>' +
    `<div class="mapcredit" style="margin-top:6px;color:var(--mut)">${mapCreditHtml()}</div>` +
    `<div style="margin-top:6px">${t('sourceCode')} : ` +
    `<a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--accent)">github.com/s-celles/ogn-3d-viewer</a></div>` +
    `<div style="margin-top:4px;color:var(--mut)">${t('version')} ${APP_VERSION} · ${commit}</div>` +
    `<div style="margin-top:4px;color:var(--mut)">${t('author')} : ` +
    `<a href="https://linktr.ee/SebastienCelles" target="_blank" rel="noopener" style="color:var(--accent)">Sébastien Celles</a> · ${t('license')} : ` +
    `<a href="${REPO_URL}/blob/main/LICENSE" target="_blank" rel="noopener" style="color:var(--accent)">AGPL-3.0</a></div>` +
    `<div id="cacheInfo" style="margin-top:4px;color:var(--mut)">${t('cacheLabel')} : …</div>` +
    `<div style="margin-top:6px">${t('appLink')} : ` +
    `<a href="${appUrl()}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all">${appUrl().replace(/^https?:\/\//, '')}</a></div>` +
    `<div style="margin-top:10px;display:flex;gap:10px;align-items:center">` +
      `<div id="qrImg" style="width:104px;height:104px;flex:0 0 auto;background:#fff;border-radius:8px;padding:6px;box-sizing:border-box"></div>` +
      `<div style="min-width:0"><div style="color:var(--mut);font-size:12px">${t('qrShare')}</div>` +
      `<div id="qrUrl" style="font-size:11px;color:var(--mut);word-break:break-all;margin-top:4px"></div></div>` +
    `</div>`;
  const gb = document.getElementById('discGuideBtn'); if (gb) gb.onclick = () => openGuide();
  updateQr();
}
// The ⓘ panel content (discEl) as a floating overlay — used from the Discover
// landing page, where the normal controls panel is dimmed/behind. discEl is moved
// into a top-level overlay and restored on close, so the in-panel ⓘ still works.
let infoOv: HTMLElement | null = null, discHome: Node | null = null;
export function openInfoFloat(): void {
  renderDisc(); updateCacheInfo();
  if (!infoOv) {
    infoOv = document.createElement('div');
    infoOv.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(4,8,12,.6);display:none;overflow:auto;padding:5vh 16px';
    infoOv.onclick = e => { if (e.target === infoOv) closeInfoFloat(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && infoOv && infoOv.style.display === 'block') closeInfoFloat(); });
    document.body.appendChild(infoOv);
  }
  const card = document.createElement('div');
  card.className = 'disc';
  card.style.cssText = 'position:relative;max-width:520px;margin:0 auto;background:#0e141b;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:16px 18px';
  const x = document.createElement('button'); x.textContent = '✕'; x.style.cssText = 'position:absolute;top:8px;right:10px;padding:2px 8px'; x.onclick = closeInfoFloat;
  discHome = discEl.parentNode;
  discEl.style.display = 'block'; discEl.style.pointerEvents = 'auto';
  card.append(x, discEl);
  infoOv.innerHTML = ''; infoOv.append(card); infoOv.style.display = 'block';
}
export function closeInfoFloat(): void {
  if (infoOv) infoOv.style.display = 'none';
  discEl.style.display = 'none';
  if (discHome) discHome.appendChild(discEl);   // restore so the controls-panel ⓘ keeps working
}
// A self-contained QR code (SVG) for the current app URL — scan to open the same
// view on a phone. Uses the enriched share link when a flight is loaded.
function qrSvg(text: string): string {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" style="width:100%;height:100%;display:block"><path d="${d}" fill="#0b0f14"/></svg>`;
}
function appUrl(): string { const u = new URL(location.href); return u.origin + u.pathname; }   // the app's own address (no query/hash)
function qrTarget(): string {
  return (S.ready && S.source !== 'file') ? shareUrl() : appUrl();
}
export function updateQr(): void {
  const box = document.getElementById('qrImg'); if (!box) return;
  const target = qrTarget();
  box.innerHTML = qrSvg(target);
  const url = document.getElementById('qrUrl'); if (url) url.textContent = target.replace(/^https?:\/\//, '');
}

// Fill the #cacheInfo line with the persistent map-tile cache size: the tile
// count in the service-worker cache, plus the origin's on-disk usage estimate
// (dominated by tiles once the user has browsed). Refreshed when the panel opens.
async function updateCacheInfo(): Promise<void> {
  const el = document.getElementById('cacheInfo'); if (!el) return;
  let tiles = 0, bytes = 0;
  try { if ('caches' in window) tiles = (await (await caches.open('ogn-tiles-v1')).keys()).length; } catch { /* ignore */ }
  try { const e = await navigator.storage?.estimate?.(); bytes = e?.usage || 0; } catch { /* ignore */ }
  const mb = bytes ? bytes / 1048576 : tiles * 30 / 1024;   // fall back to ~30 KB/tile
  const mbStr = mb >= 10 ? Math.round(mb).toString() : mb.toFixed(1);
  el.textContent = `${t('cacheLabel')} : ${tiles} ${t('cacheTiles')} · ~${mbStr} ${t('cacheUnit')}`;
}

// The FlightBook link next to the airfield label — points at the OGN FlightBook
// page for the currently typed/loaded airfield + date (round-trip with the
// ?icao=…&date=… deep link). Updated live as the inputs change.
// The place shown under the code (flag + name), so you can tell where a site is.
// Comes from the loaded FlightBook airfield, or from a picked terrain-only spot.
let place: { name: string; flag: string } | null = null;
let lastAfKey = '';
/** Show a discovered spot's name/flag (for terrain-only picks); null clears it. */
export function setPlace(name: string | null, flag = ''): void { place = name ? { name, flag } : null; renderPlace(); }
function renderPlace(): void {
  const p = place || (S.AF && S.AF.name ? { name: S.AF.name, flag: codeFlag(S.AF.code) } : null);
  const key = p ? p.flag + '|' + p.name : '';
  if (key === lastAfKey) return;
  lastAfKey = key;
  if (p) { afInfo.innerHTML = `${p.flag} <b>${p.name}</b>`.trim(); afInfo.style.display = ''; }
  else { afInfo.textContent = ''; afInfo.style.display = 'none'; }
}
export function updateFbLink(): void {
  renderPlace();   // dirty-checked; cheap to call each frame
  // Share-link button: only when there's a loaded OGN session to deep-link to.
  copyBtn.style.display = (!HAS_SHARE && S.ready && S.source !== 'file') ? '' : 'none';   // 🔗 only where Web Share is unavailable
  if (S.source === 'file') { fblink.style.display = 'none'; return; }   // no FlightBook for local files
  const code = icaoEl.value.trim().toUpperCase() || (S.AF && S.AF.code) || '';
  const date = dateEl.value || S.date;
  if (code.length >= 3) {
    fblink.href = `${API_BASE}/logbook/${code}/` + (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '');
    fblink.style.display = '';
  } else {
    fblink.style.display = 'none';
  }
}
infoBtn.onclick = () => { const open = discEl.style.display !== 'none'; discEl.style.display = open ? 'none' : 'block'; infoBtn.classList.toggle('on', !open); if (!open) { updateCacheInfo(); updateQr(); } };

// ---- shareable deep link (current moment + selected aircraft) ----
// The address bar already carries icao/date/mode (syncUrl); here we add the
// current time (?t=HHMMSS, local clock) and selected aircraft (?reg=) so the
// link reopens on that exact frame. `reg` is neutral — the subject may be a
// glider, a tug or a powered aircraft.
function shareUrl(): string {
  const u = new URL(location.href);
  u.searchParams.set('view', S.mode);                                                    // over / fpv / chase
  if (S.subject) u.searchParams.set('reg', S.subject); else u.searchParams.delete('reg');
  if (S.mode === 'fpv' && !S.fpvFollow) u.searchParams.set('cam', 'free'); else u.searchParams.delete('cam');
  if (S.speed !== 8) u.searchParams.set('speed', String(S.speed)); else u.searchParams.delete('speed');
  if (S.ready && !S.live) u.searchParams.set('t', fmt(S.cur).replace(/:/g, '')); else u.searchParams.delete('t');
  return u.toString();
}
copyBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareUrl());
    const prev = copyBtn.textContent; copyBtn.textContent = '✓'; copyBtn.classList.add('on');
    setTimeout(() => { copyBtn.textContent = prev; copyBtn.classList.remove('on'); }, 1200);
  } catch { /* clipboard blocked (insecure context) — no-op */ }
};
// Native share sheet — the primary link button. Where it exists we hide 🔗
// entirely (the share sheet already offers "copy"); 🔗 is only the fallback.
if (HAS_SHARE) { shareBtn.style.display = ''; copyBtn.style.display = 'none'; }
shareBtn.onclick = async () => {
  try { await navigator.share({ title: 'OGN 3D Viewer', url: (S.ready && S.source !== 'file') ? shareUrl() : appUrl() }); }
  catch { /* user dismissed / unsupported */ }
};

/**
 * Apply ?reg= (selected aircraft) and ?t= (HHMMSS, local clock) from a shared
 * deep link, once the data has loaded. Pauses on the shared instant. Called from
 * main.ts after loadFlights/setLive resolves.
 */
export function applyDeepLinkCursor(qp: URLSearchParams): void {
  if (!S.ready) return;
  // View first: setMode(fpv/chase) from the overview adopts the centred glider,
  // which would clobber ?reg — so pick the view, THEN force the shared subject.
  const view = (qp.get('view') || '').trim();
  if (view === 'over' || view === 'fpv' || view === 'chase') setMode(view);
  const reg = (qp.get('reg') || '').trim();
  if (reg && S.TRACKS.some(tr => tr.reg === reg)) { S.subject = reg; subjEl.value = reg; }
  if (S.mode === 'fpv') setFollow((qp.get('cam') || '').trim() !== 'free');   // ?cam=free → free look
  const speed = +(qp.get('speed') || '');
  if (speed > 0 && Number.isFinite(speed)) { S.speed = speed; syncSpeedUI(); }
  const digits = (qp.get('t') || '').replace(/\D/g, '');
  if (!S.live && digits.length >= 4) {
    const local = (+digits.slice(0, 2)) * 3600 + (+digits.slice(2, 4)) * 60 + (+digits.slice(4, 6) || 0);
    let cur = local - (S.AF ? S.AF.tz_off : 0) * 3600 - S.G0;   // local clock → replay-relative seconds
    if (cur < -43200) cur += 86400;                             // clock wrapped past midnight
    S.cur = Math.max(0, Math.min(S.SPAN, cur));                 // out-of-range → clamp to start/end
    S.playing = false; syncTransport();
  }
  render(); syncUI();
}

// ---- keyboard ----
window.addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  if (e.key === 'v' || e.key === 'V') { const order: Mode[] = ['over', 'fpv', 'chase']; setMode(order[(order.indexOf(S.mode) + 1) % 3]); }
  else if ('123'.includes(e.key)) {
    const regs = cycleRegs(), reg = regs[+e.key - 1];
    if (reg) {
      if (S.mode === 'over') { S.focusLock = reg; S.focus = reg; }   // overview: pin the focus
      else { S.subject = reg; subjEl.value = reg; }
      render(); syncUI();
    }
  } else if (e.key === 'j' || e.key === 'J') cycleSubject(-1);   // previous aircraft
  else if (e.key === 'k' || e.key === 'K') cycleSubject(1);      // next aircraft
  else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }          // play / pause (forward)
  else if (e.key === 'b' || e.key === 'B') revBtn.click();                   // play / pause backward
  else if (S.mode === 'over') {
    if (e.key === 'ArrowLeft') S.mapTarget.bearing -= 15; else if (e.key === 'ArrowRight') S.mapTarget.bearing += 15;
    else if (e.key === 'ArrowUp') S.mapTarget.pitch = clampv(S.mapTarget.pitch + 8, PMIN, PMAX);
    else if (e.key === 'ArrowDown') S.mapTarget.pitch = clampv(S.mapTarget.pitch - 8, PMIN, PMAX);
    else if (e.key === '+' || e.key === '=') S.mapTarget.zoom = clampv(S.mapTarget.zoom + 0.6, MINZ, MAXZ);
    else if (e.key === '-') S.mapTarget.zoom = clampv(S.mapTarget.zoom - 0.6, MINZ, MAXZ);
  }
});
