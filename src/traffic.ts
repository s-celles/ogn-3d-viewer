// ============ traffic-awareness radar (focus views) ============
// A small "track-up" radar (top-right, cockpit & chase only): own ship at the
// centre, other airborne aircraft placed by relative bearing/distance, coloured
// by threat level (alert / warn / other) with their relative altitude. Generic
// traffic display — not tied to any particular onboard system.
import { S } from './state';
import { trafficCanvas } from './dom';
import { subjectTrack, posAt, airborne, headingAt } from './flight-math';
import { TRAFFIC } from './config';
import { t } from './i18n';

export function drawTraffic(): void {
  if (!S.traffic || !(S.mode === 'fpv' || S.mode === 'chase') || !S.ready || !S.TRACKS.length) return;
  const cv = trafficCanvas, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

  const sub = subjectTrack(); if (!sub) return;
  const s = posAt(sub, S.cur), hdg = headingAt(sub, S.cur) * Math.PI / 180;
  const cx = W / 2, cy = H / 2 - 4, R = Math.min(W, H) / 2 - 18, range = TRAFFIC.range;

  // range rings
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, 7); ctx.stroke(); ctx.setLineDash([]);

  const mLat = 111320, mLng = 111320 * Math.cos(s[1] * Math.PI / 180);
  let worst = 0;
  for (const tr of S.TRACKS) {
    if (tr.reg === sub.reg || !airborne(tr, S.cur)) continue;
    const p = posAt(tr, S.cur);
    const dE = (p[0] - s[0]) * mLng, dN = (p[1] - s[1]) * mLat, dist = Math.hypot(dE, dN);
    if (dist > range) continue;
    const dAlt = p[2] - s[2], av = Math.abs(dAlt);
    const lvl = (dist < TRAFFIC.alert.h && av < TRAFFIC.alert.v) ? 2
      : (dist < TRAFFIC.warn.h && av < TRAFFIC.warn.v) ? 1 : 0;
    worst = Math.max(worst, lvl);
    const col = lvl === 2 ? '#ff4d4d' : lvl === 1 ? '#ffb02e' : '#cfe0ee';
    // track-up screen position (forward = up)
    const rel = Math.atan2(dE, dN) - hdg, fr = dist / range;
    const x = cx + Math.sin(rel) * fr * R, y = cy - Math.cos(rel) * fr * R;
    const r = lvl === 2 ? 5 : 4;
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    // relative altitude (m, rounded to 10) + climb/descent arrow
    ctx.font = '9px ui-sans-serif,system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col; ctx.fillText((dAlt >= 0 ? '+' : '-') + Math.round(av / 10) * 10, x + r + 2, y);
    if (av > 40) { ctx.fillText(dAlt > 0 ? '▲' : '▼', x - r - 8, y); }
  }

  // own ship (triangle pointing up)
  ctx.fillStyle = '#ff8c00'; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx - 5, cy + 5); ctx.lineTo(cx + 5, cy + 5); ctx.closePath(); ctx.fill();
  // alert/warn outline
  if (worst > 0) { ctx.strokeStyle = worst === 2 ? '#ff4d4d' : 'rgba(255,176,46,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, 7); ctx.stroke(); }
  // label
  ctx.fillStyle = '#9fb0c0'; ctx.font = '9px ui-sans-serif,system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(t('traffic') + ' · ' + (range / 1000) + ' km', cx, H - 1);
}
