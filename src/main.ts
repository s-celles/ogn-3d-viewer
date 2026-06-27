// ============ entry point: init + animation loop ============
import { S } from './state';
import { dateEl, icaoEl } from './dom';
import { initDeck, render } from './render';
import { applyI18n, applyFollowClass, syncUI, easeCamera, updateCompass, updateFbLink } from './ui';
import { loadFlights } from './data';

const todayStr = new Date().toISOString().slice(0, 10);
dateEl.value = todayStr; dateEl.max = todayStr;

// PWA: register the network-first service worker (production builds only — dev
// has no sw.js). Relative path so the scope is the GitHub Pages subpath.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

initDeck();
applyI18n(); applyFollowClass(); syncUI();

// Deep link: ?icao=LFBI (optionally &date=YYYY-MM-DD) preselects and loads an
// airfield, so links to/from the OGN FlightBook work (and the URL stays
// shareable — loadFlights keeps it in sync). `oaci` is accepted as an alias.
const qp = new URLSearchParams(location.search);
const qIcao = (qp.get('icao') || qp.get('oaci') || '').trim().toUpperCase();
if (qIcao) {
  icaoEl.value = qIcao;
  const qDate = (qp.get('date') || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate <= todayStr) dateEl.value = qDate;
  updateFbLink();   // inputs were set programmatically (no input event)
  loadFlights(qIcao, dateEl.value);
}

const nowSod = () => (Date.now() / 1000) % 86400; // current UTC seconds-of-day
let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000; last = now;
  if (S.ready && S.live) { S.cur = Math.max(0, nowSod() - S.G0); syncUI(); }       // pin to real time
  else if (S.ready && S.playing) { S.cur += dt * S.speed; if (S.cur > S.SPAN + 300) S.cur = 0; syncUI(); }
  if (S.mode === 'over') easeCamera();
  updateCompass(); render(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
