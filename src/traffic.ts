// ============ traffic-awareness display (focus views) ============
// Two styles, top-right in cockpit & chase views:
//  - radar:        track-up plan view, all nearby aircraft as dots
//  - directional:  the most-threatening target only — a ring of chevrons points
//                  to its bearing, a 5-cell column shows its relative elevation,
//                  and a readout shows its distance (classic threat-indicator
//                  layout; generic, not tied to any onboard system).
import { S } from './state';
import { trafficCanvas } from './dom';
import { subjectTrack, posAt, airborne, headingAt } from './flight-math';
import { TRAFFIC } from './config';
import { t } from './i18n';

interface Tgt { dist: number; dAlt: number; rel: number; lvl: number; }
const ALERT = '#ff4d4d', WARN = '#ffb02e', OTHER = '#cfe0ee', DIM = 'rgba(190,205,225,0.38)';
const col = (lvl: number) => (lvl === 2 ? ALERT : lvl === 1 ? WARN : OTHER);

// Other airborne aircraft within range of the subject, with threat level.
function compute(): { hdg: number; list: Tgt[] } | null {
  const sub = subjectTrack(); if (!sub) return null;
  const s = posAt(sub, S.cur), hdg = headingAt(sub, S.cur) * Math.PI / 180;
  const mLat = 111320, mLng = 111320 * Math.cos(s[1] * Math.PI / 180), list: Tgt[] = [];
  for (const tr of S.TRACKS) {
    if (tr.reg === sub.reg || !airborne(tr, S.cur)) continue;
    const p = posAt(tr, S.cur), dE = (p[0] - s[0]) * mLng, dN = (p[1] - s[1]) * mLat, dist = Math.hypot(dE, dN);
    if (dist > TRAFFIC.range) continue;
    const dAlt = p[2] - s[2], av = Math.abs(dAlt);
    const lvl = (dist < TRAFFIC.alert.h && av < TRAFFIC.alert.v) ? 2 : (dist < TRAFFIC.warn.h && av < TRAFFIC.warn.v) ? 1 : 0;
    list.push({ dist, dAlt, rel: Math.atan2(dE, dN) - hdg, lvl });
  }
  return { hdg, list };
}

export function drawTraffic(): void {
  if (S.trafficMode === 'off' || !(S.mode === 'fpv' || S.mode === 'chase') || !S.ready || !S.TRACKS.length) return;
  const cv = trafficCanvas, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const data = compute(); if (!data) return;
  if (S.trafficMode === 'radar') drawRadar(ctx, W, H, data);
  else drawDirectional(ctx, W, H, data);
}

// ---- radar (track-up plan view) ----
function drawRadar(ctx: CanvasRenderingContext2D, W: number, H: number, data: { list: Tgt[] }): void {
  const cx = W / 2, cy = H / 2 - 4, R = Math.min(W, H) / 2 - 18, range = TRAFFIC.range;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  let worst = 0;
  for (const tg of data.list) {
    worst = Math.max(worst, tg.lvl);
    const c = col(tg.lvl), fr = tg.dist / range, x = cx + Math.sin(tg.rel) * fr * R, y = cy - Math.cos(tg.rel) * fr * R, r = tg.lvl === 2 ? 5 : 4;
    ctx.fillStyle = c; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    ctx.font = '9px ui-sans-serif,system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText((tg.dAlt >= 0 ? '+' : '-') + Math.round(Math.abs(tg.dAlt) / 10) * 10, x + r + 2, y);
    if (Math.abs(tg.dAlt) > 40) ctx.fillText(tg.dAlt > 0 ? '▲' : '▼', x - r - 8, y);
  }
  plane(ctx, cx, cy, '#ff8c00');
  if (worst > 0) { ctx.strokeStyle = worst === 2 ? ALERT : 'rgba(255,176,46,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, 7); ctx.stroke(); }
  ctx.fillStyle = '#9fb0c0'; ctx.font = '9px ui-sans-serif,system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(t('traffic') + ' · ' + (range / 1000) + ' km', cx, H - 1);
}

// ---- directional (nearest-threat indicator) ----
function drawDirectional(ctx: CanvasRenderingContext2D, W: number, H: number, data: { list: Tgt[] }): void {
  const tgt = data.list.length ? data.list.slice().sort((a, b) => b.lvl - a.lvl || a.dist - b.dist)[0] : null;
  const c = tgt ? col(tgt.lvl) : DIM;
  const cxr = W * 0.40, cyr = H * 0.44, rr = Math.min(W, H) * 0.32;
  // chevron ring (tip inward); light the one toward the threat bearing
  const idx = tgt ? (((Math.round(tgt.rel / (Math.PI / 6)) % 12) + 12) % 12) : -1;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, ru = [Math.sin(a), -Math.cos(a)], pu = [Math.cos(a), Math.sin(a)], w = 4.2;
    const tx = cxr + ru[0] * (rr - 9), ty = cyr + ru[1] * (rr - 9), bx = cxr + ru[0] * rr, by = cyr + ru[1] * rr;
    ctx.fillStyle = i === idx ? c : DIM; ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(bx + pu[0] * w, by + pu[1] * w); ctx.lineTo(bx - pu[0] * w, by - pu[1] * w); ctx.closePath(); ctx.fill();
  }
  plane(ctx, cxr, cyr, '#e7edf3');
  // relative-elevation column (above >14° / >7° / level / >7° below / >14° below)
  const eAng = tgt ? Math.atan2(tgt.dAlt, Math.max(1, tgt.dist)) * 180 / Math.PI : null;
  const cell = eAng == null ? -1 : eAng > 14 ? 0 : eAng > 7 ? 1 : eAng >= -7 ? 2 : eAng >= -14 ? 3 : 4;
  const colX = W - 20, ch = 12, gap = 5, top = cyr - (ch * 5 + gap * 4) / 2;
  for (let i = 0; i < 5; i++) {
    const y = top + i * (ch + gap);
    ctx.fillStyle = i === cell ? c : DIM;
    ctx.beginPath(); (ctx as any).roundRect(colX - 8, y, 16, ch, 3); ctx.fill();
    if (i === 2) { ctx.strokeStyle = '#0c1015'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(colX - 5, y + ch / 2); ctx.lineTo(colX + 5, y + ch / 2); ctx.stroke(); }
  }
  ctx.fillStyle = '#7f8ea0'; ctx.font = '8px ui-sans-serif,system-ui'; ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom'; ctx.fillText('▲', colX, top - 1);
  ctx.textBaseline = 'top'; ctx.fillText('▼', colX, top + ch * 5 + gap * 4 + 1);
  // distance readout
  ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '600 24px ui-sans-serif,system-ui'; ctx.fillText(tgt ? (tgt.dist / 1000).toFixed(1) : '– –', cxr, H - 10);
  ctx.fillStyle = '#9fb0c0'; ctx.font = '8px ui-sans-serif,system-ui'; ctx.textBaseline = 'bottom'; ctx.fillText('km', cxr, H - 1);
}

// Small top-view plane silhouette centred at (cx,cy).
function plane(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 10, cy - 1); ctx.lineTo(cx + 10, cy - 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 4, cy + 7); ctx.lineTo(cx + 4, cy + 7); ctx.stroke();
}
