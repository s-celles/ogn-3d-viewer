// ============ time-series graphs for the focused aircraft ============
// A bottom drawer showing one chart at a time (tabs: vario / altitude / speed /
// heading) for the subject's flight. The series is built from the RAW OGN
// beacons (one dot per measurement); consecutive beacons are joined by a solid
// line, and gaps with no data are bridged by a DASHED line (interpolation), so
// there is never a hard break. The x-axis window follows S.graphMode:
//   hist     — start → now, the past fills the full width (right edge = now)
//   histfut  — whole flight, a vertical line marks now (future drawn dimmed)
//   rolling  — a window of S.windowMin minutes ending at now
// Robust (percentile) y-ranges + a light median de-spike so glitch beacons
// can't wreck the scale; the cursor value is computed live (matches the HUD).
import { S } from './state';
import { graphCanvas, graphTabs } from './dom';
import { subjectTrack, varioAt, headingAt, posAt, groundSpeedAt } from './flight-math';
import { terrainElevAt } from './terrain';
import { syncUI } from './ui';
import { t } from './i18n';
import type { RenderTrack } from './types';

interface Series {
  key: string; t: number[]; vario: number[]; alt: number[]; terr: (number | null)[]; hdg: number[]; spd: number[];
  t0: number; t1: number; aLo: number; aHi: number; vMax: number; sMax: number; gap: number;
}
let cache: Series | null = null;
let tab = 'vario';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const seriesKey = (tr: RenderTrack) =>
  `${tr.reg}|${S.spline}|${S.compensated}|${S.TRACKS.length}|${S.altOffset.toFixed(1)}`;

// p-quantile of finite values (robust to outliers / glitch beacons).
function pct(arr: number[], p: number): number {
  const f = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return f.length ? f[clamp(Math.floor(p * f.length), 0, f.length - 1)] : 0;
}

// Sliding-window median — removes isolated spikes (GPS glitches) from the noisy
// derivative-based series (vario, speed) without smoothing the real signal.
function medianFilter(a: number[], win: number): number[] {
  const h = win >> 1, out = a.slice();
  for (let i = 0; i < a.length; i++) {
    const s: number[] = [];
    for (let j = -h; j <= h; j++) { const k = i + j; if (k >= 0 && k < a.length) s.push(a[k]); }
    s.sort((x, y) => x - y); out[i] = s[s.length >> 1];
  }
  return out;
}

interface Metric {
  id: string; label: () => string; color: string;
  vals: (s: Series) => number[]; range: (s: Series) => [number, number];
  cur: (tr: RenderTrack) => number; fmt: (v: number) => string; wrap?: boolean; terr?: boolean;
}
const METRICS: Metric[] = [
  // Geometric GPS climb rate (not the compensated/TE vario): a historical trace
  // reads far more cleanly this way; the compensated vario stays in the HUD.
  { id: 'vario', label: () => t('vario') + ' (m/s)', color: '#5fd3ff', vals: s => s.vario, range: s => [-s.vMax, s.vMax], cur: tr => varioAt(tr, S.cur), fmt: v => v.toFixed(1) },
  { id: 'alt', label: () => t('alt') + ' (m)', color: '#9be38b', vals: s => s.alt, range: s => [s.aLo, s.aHi], cur: tr => posAt(tr, S.cur)[2], fmt: v => String(Math.round(v)), terr: true },
  { id: 'spd', label: () => t('speed') + ' (km/h)', color: '#c79bff', vals: s => s.spd, range: s => [0, s.sMax], cur: tr => groundSpeedAt(tr, S.cur) * 3.6, fmt: v => String(Math.round(v)) },
  { id: 'hdg', label: () => t('hdg') + ' (°)', color: '#ffb05a', vals: s => s.hdg, range: () => [0, 360], cur: tr => headingAt(tr, S.cur), fmt: v => String(Math.round(v)), wrap: true },
];

// Build the series from the RAW beacons (one point per measurement).
function build(tr: RenderTrack): Series {
  const raw = tr.path, N = raw.length, stride = Math.max(1, Math.floor(N / 3000));
  const tA: number[] = [], vA: number[] = [], aA: number[] = [], gA: (number | null)[] = [], hA: number[] = [], sA: number[] = [];
  for (let i = 0; i < N; i += stride) {
    const p = raw[i], rt = p[3] - S.G0;
    tA.push(rt); aA.push(p[2] - S.altOffset); vA.push(varioAt(tr, rt)); hA.push(headingAt(tr, rt)); sA.push(groundSpeedAt(tr, rt) * 3.6);
    const g = terrainElevAt(p[0], p[1]); gA.push(g != null && g > -1000 ? g : null);
  }
  const vF = medianFilter(vA, 3), sF = medianFilter(sA, 3);
  for (let i = 0; i < vA.length; i++) { vA[i] = vF[i]; sA[i] = sF[i]; }
  // robust y-ranges
  const vMax = clamp(Math.ceil(Math.max(Math.abs(pct(vA, 0.02)), Math.abs(pct(vA, 0.98)))), 2, 10);
  let aLo = pct(aA, 0.01), aHi = pct(aA, 0.99);
  for (const g of gA) if (g != null) aLo = Math.min(aLo, g);
  const pad = Math.max(20, (aHi - aLo) * 0.08);
  const sMax = clamp(Math.ceil(pct(sA, 0.98) / 10) * 10, 30, 450);
  // gap threshold = a few times the typical beacon interval
  const dts: number[] = []; for (let i = 1; i < tA.length; i++) dts.push(tA[i] - tA[i - 1]);
  const gap = Math.max(20, (pct(dts, 0.5) || 1) * 6);
  return { key: seriesKey(tr), t: tA, vario: vA, alt: aA, terr: gA, hdg: hA, spd: sA, t0: tr.rstart, t1: tr.rend, aLo: aLo - pad, aHi: aHi + pad, vMax, sMax, gap };
}

const PAD_L = 38, PAD_R = 8, PAD_T = 6, PAD_B = 14;

export function drawGraphs(): void {
  if (S.graphMode === 'off' || !S.ready || !S.TRACKS.length) return;
  const tr = subjectTrack(); if (!tr || tr.rel.length < 2) return;
  if (!cache || cache.key !== seriesKey(tr)) cache = build(tr);
  const s = cache, cv = graphCanvas;
  const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

  const m = METRICS.find(x => x.id === tab) || METRICS[0];
  const vals = m.vals(s), [lo, hi] = m.range(s);
  const x0 = PAD_L, y0 = PAD_T, w = W - PAD_L - PAD_R, h = H - PAD_T - PAD_B;
  const cur = clamp(S.cur, s.t0, s.t1);
  let xMin = s.t0, xMax = s.t1, drawFrom = s.t0;
  if (S.graphMode === 'hist') xMax = cur;
  else if (S.graphMode === 'rolling') { const win = Math.max(60, S.windowMin * 60); xMax = cur; xMin = cur - win; drawFrom = xMin; }
  if (xMax - xMin < 1) xMax = xMin + 1;
  const X = (ti: number) => x0 + (ti - xMin) / (xMax - xMin) * w;
  const Y = (val: number) => y0 + (1 - (clamp(val, lo, hi) - lo) / (hi - lo)) * h;

  // y gridlines + labels
  ctx.font = '10px ui-sans-serif,system-ui'; ctx.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const val = lo + (hi - lo) * g / 4, yy = Y(val);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + w, yy); ctx.stroke();
    ctx.fillStyle = '#7f8ea0'; ctx.textAlign = 'right'; ctx.fillText(m.fmt(val), x0 - 4, yy);
  }
  // terrain profile (altitude tab)
  if (m.terr) {
    ctx.fillStyle = 'rgba(120,96,60,0.4)'; ctx.beginPath(); let on = false; let lastX = 0;
    const flush = () => { if (on) { ctx.lineTo(lastX, Y(lo)); ctx.closePath(); ctx.fill(); ctx.beginPath(); on = false; } };
    for (let i = 0; i < s.terr.length; i++) {
      const ti = s.t[i]; if (ti < drawFrom) continue; if (ti > cur) break;
      const g = s.terr[i]; if (g == null) { flush(); continue; }
      const xx = X(ti); lastX = xx;
      if (!on) { ctx.moveTo(xx, Y(lo)); ctx.lineTo(xx, Y(g)); on = true; } else ctx.lineTo(xx, Y(g));
    }
    flush();
  }

  // value: solid line over dense beacons, dashed across gaps, + a dot per beacon
  const seg = (a: number, b: number, alpha: number) => {
    ctx.globalAlpha = alpha; ctx.strokeStyle = m.color; ctx.lineWidth = 1.6;
    const brk = (i: number) => (m.wrap && Math.abs(vals[i] - vals[i - 1]) > 180) || (s.t[i] - s.t[i - 1] > s.gap);
    ctx.setLineDash([]); ctx.beginPath(); let pen = false;          // solid runs
    for (let i = 0; i < vals.length; i++) {
      const ti = s.t[i]; if (ti < a || ti > b) { pen = false; continue; }
      if (pen && brk(i)) pen = false;
      const xx = X(ti), yy = Y(vals[i]); pen ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.beginPath();                       // dashed gap bridges
    for (let i = 1; i < vals.length; i++) {
      const ti = s.t[i]; if (ti < a || ti > b || s.t[i - 1] < a) continue;
      if (s.t[i] - s.t[i - 1] > s.gap && !(m.wrap && Math.abs(vals[i] - vals[i - 1]) > 180)) { ctx.moveTo(X(s.t[i - 1]), Y(vals[i - 1])); ctx.lineTo(X(ti), Y(vals[i])); }
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = m.color;                                        // measurement dots
    for (let i = 0; i < vals.length; i++) { const ti = s.t[i]; if (ti < a || ti > b) continue; ctx.fillRect(X(ti) - 1.3, Y(vals[i]) - 1.3, 2.6, 2.6); }
    ctx.globalAlpha = 1;
  };
  seg(drawFrom, cur, 1);
  if (S.graphMode === 'histfut') seg(cur, s.t1, 0.3);

  // cursor marker + live value (computed directly → matches the HUD)
  const cx = X(cur), curVal = m.cur(tr);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y0 + h); ctx.stroke();
  ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(cx, Y(curVal), 3.2, 0, 7); ctx.fill();
  ctx.fillStyle = '#e7edf3'; ctx.textBaseline = 'top'; ctx.font = '600 12px ui-sans-serif,system-ui';
  ctx.textAlign = cx > W - 70 ? 'right' : 'left';
  ctx.fillText(m.fmt(curVal), cx + (cx > W - 70 ? -6 : 6), y0 + 2);
}

// Refresh tab button labels (initial + on language change).
export function refreshGraphTabs(): void {
  [...graphTabs.children].forEach(b => {
    const el = b as HTMLElement, m = METRICS.find(x => x.id === el.dataset.id);
    if (m) { el.textContent = m.label(); el.classList.toggle('on', el.dataset.id === tab); }
  });
}

export function initGraphs(): void {
  METRICS.forEach(m => {
    const b = document.createElement('button'); b.dataset.id = m.id;
    b.onclick = () => { tab = m.id; refreshGraphTabs(); };
    graphTabs.appendChild(b);
  });
  refreshGraphTabs();
  let dragging = false;
  const scrub = (clientX: number) => {
    if (!cache || !S.ready) return;
    const r = graphCanvas.getBoundingClientRect(), w = r.width - PAD_L - PAD_R;
    const frac = clamp((clientX - r.left - PAD_L) / w, 0, 1);
    const cur = clamp(S.cur, cache.t0, cache.t1);
    let xMin = cache.t0, xMax = cache.t1;
    if (S.graphMode === 'hist') xMax = cur;
    else if (S.graphMode === 'rolling') { const win = Math.max(60, S.windowMin * 60); xMax = cur; xMin = cur - win; }
    if (xMax - xMin < 1) xMax = xMin + 1;
    S.cur = clamp(xMin + frac * (xMax - xMin), cache.t0, cache.t1); syncUI();
  };
  graphCanvas.addEventListener('pointerdown', e => { dragging = true; graphCanvas.setPointerCapture(e.pointerId); scrub(e.clientX); });
  graphCanvas.addEventListener('pointermove', e => { if (dragging) scrub(e.clientX); });
  graphCanvas.addEventListener('pointerup', () => { dragging = false; });
}
