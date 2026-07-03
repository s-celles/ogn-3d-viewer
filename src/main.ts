// ============ entry point: init + animation loop ============
import { S } from './state';
import { dateEl, icaoEl } from './dom';
import { initDeck, render } from './render';
import { applyI18n, applyFollowClass, syncUI, syncAcScale, syncControls, easeCamera, updateCompass, updateFbLink, setLive, applyDeepLinkCursor } from './ui';
import { loadFlights } from './data';
import { initGraphs } from './graphs';
import { initAnalytics } from './analytics';
import { initDev, devFrame } from './dev';
import './spots';   // registers the "Discover spots" button + overlay
import { postCacheCap } from './sw-cache';

const todayStr = new Date().toISOString().slice(0, 10);
dateEl.value = todayStr; dateEl.max = todayStr;

// PWA: register the network-first service worker (production builds only — dev
// has no sw.js). Relative path so the scope is the GitHub Pages subpath.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  // Push the persistent tile-cache cap once a worker controls the page (and again
  // if it changes), so the user's cache-size setting reaches the service worker.
  navigator.serviceWorker.ready.then(postCacheCap).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', postCacheCap);
}

// Privacy-respecting, cookieless usage stats (canonical deploy only; honours DNT/GPC).
initAnalytics();

initDeck();
initGraphs();
syncControls(); applyI18n(); applyFollowClass(); syncUI(); syncAcScale();
initDev();   // developer panel + HUD (only when ?dev=1 / persisted)

// Deep link: ?icao=LFBI preselects and loads an airfield, so links to/from the
// OGN FlightBook work (and the URL stays shareable — loadFlights keeps it in
// sync). `mode=live` opens the real-time view; `mode=replay` (the default)
// replays &date=YYYY-MM-DD (today if omitted). `oaci` is accepted as an alias.
const qp = new URLSearchParams(location.search);
const qIcao = (qp.get('icao') || qp.get('oaci') || '').trim().toUpperCase();
if (qIcao) {
  icaoEl.value = qIcao;
  updateFbLink();   // inputs were set programmatically (no input event)
  if ((qp.get('mode') || '').trim().toLowerCase() === 'live') {
    setLive().then(() => applyDeepLinkCursor(qp));       // real-time mode (loads today, auto-refreshes)
  } else {
    const qDate = (qp.get('date') || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate <= todayStr) dateEl.value = qDate;
    loadFlights(qIcao, dateEl.value).then(() => applyDeepLinkCursor(qp));  // ?t=…&reg=… → frame + aircraft
  }
}

const nowSod = () => (Date.now() / 1000) % 86400; // current UTC seconds-of-day
let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000; last = now;
  if (S.ready && S.live) { S.cur = Math.max(0, nowSod() - S.G0); syncUI(); }       // pin to real time
  else if (S.ready && S.playing) { S.cur += dt * S.speed; if (S.cur > S.SPAN + 300) S.cur = 0; syncUI(); }
  if (S.mode === 'over') easeCamera();
  updateCompass(); render(); devFrame(dt); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
