// ============ entry point: init + animation loop ============
import { S } from './state';
import { dateEl } from './dom';
import { initDeck, render } from './render';
import { applyI18n, applyFollowClass, syncUI, easeCamera, updateCompass } from './ui';
// Imported for its side effects; ui.ts already pulls it in, but importing here
// keeps the dependency explicit.
import './data';

const todayStr = new Date().toISOString().slice(0, 10);
dateEl.value = todayStr; dateEl.max = todayStr;

initDeck();
applyI18n(); applyFollowClass(); syncUI();

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
