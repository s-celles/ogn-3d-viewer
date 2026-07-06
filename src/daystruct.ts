// ============ day-structure panel: a mini emagram of the convective day ===========
// A compact vertical diagram at the current hour: the environmental temperature
// sounding, the surface parcel's dry adiabat (whose crossing sets the thermal
// ceiling), the cloudbase (LCL) and the ceiling — plus a one-line summary (convective
// depth, cumulus vs blue). Helps read WHY the thermal field looks the way it does.
import { S } from './state';
import { t } from './i18n';
import { getWeather, weatherSounding, type Sounding } from './weather';

const W = 214, H = 150;                 // svg box
const PL = 8, PR = 8, PT = 10, PB = 10; // plot margins
const DRY = 0.0098, EXCESS = 1.5;       // dry-adiabatic lapse (K/m) + parcel excess (matches weatherConvTop)
const NS = 'http://www.w3.org/2000/svg';
const el = (n: string, a: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, String(a[k]));
  return e;
};

// Environmental temperature at an AMSL altitude, linearly interpolated from the sounding.
function envT(s: Sounding, alt: number): number {
  const p = s.tprof;
  if (alt <= p[0].alt) return p[0].T;
  for (let i = 1; i < p.length; i++) if (alt <= p[i].alt) {
    const a = p[i - 1], b = p[i]; return a.T + (b.T - a.T) * (alt - a.alt) / Math.max(1, b.alt - a.alt);
  }
  return p[p.length - 1].T;
}

let sig = '';
/** Draw / refresh the panel into `host` for the current view, hour and weather. Clears
 *  it when the lift potential is off or no sounding is available. Cheap: redraws only
 *  when the hour, weather-readiness or day type actually change. */
export function updateDayStruct(host: HTMLElement): void {
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude;
  const wx = S.thermalPot && S.source !== 'file' && S.date
    ? getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date) : null;
  const hour = Math.floor((S.G0 + S.cur) / 3600);
  const s = wx ? weatherSounding(wx, hour) : null;
  const key = !S.thermalPot ? 'off' : s ? `${hour}|${Math.round(s.ceiling)}|${Math.round(s.cloudbase ?? -1)}|${Math.round(s.t2m)}` : 'nowx';
  if (key === sig) return;
  sig = key;
  host.textContent = '';
  if (!S.thermalPot || !s) return;

  const ground = s.ref, ceil = s.ceiling, base = s.cloudbase;
  const top = Math.max(ceil, base ?? 0, ground + 800) + 300;
  const topClamped = Math.min(top, s.tprof[s.tprof.length - 1].alt);   // don't extrapolate the env line
  // temperature range over what we draw (env + parcel)
  const parcelT = (alt: number): number => s.t2m + EXCESS - DRY * (alt - ground);
  let tMin = Infinity, tMax = -Infinity;
  for (let a = ground; a <= topClamped + 1; a += (topClamped - ground) / 10) {
    tMin = Math.min(tMin, envT(s, a), parcelT(a)); tMax = Math.max(tMax, envT(s, a), parcelT(a));
  }
  tMin -= 1; tMax += 1;
  const x = (T: number): number => PL + (T - tMin) / Math.max(1, tMax - tMin) * (W - PL - PR);
  const y = (alt: number): number => (H - PB) - (alt - ground) / Math.max(1, topClamped - ground) * (H - PT - PB);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;height:auto;display:block` });
  // ground fill
  svg.appendChild(el('rect', { x: 0, y: y(ground), width: W, height: H - y(ground), fill: 'rgba(120,110,90,0.18)' }));
  const poly = (pts: [number, number][], stroke: string, w: number, dash = ''): void => {
    svg.appendChild(el('polyline', { points: pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), fill: 'none', stroke, 'stroke-width': w, ...(dash ? { 'stroke-dasharray': dash } : {}) }));
  };
  // environmental sounding (orange) + parcel dry adiabat (yellow, up to the ceiling)
  const envPts: [number, number][] = [];
  for (let a = ground; a <= topClamped + 1; a += (topClamped - ground) / 24) envPts.push([x(envT(s, a)), y(a)]);
  poly(envPts, 'rgba(235,150,70,0.95)', 1.6);
  poly([[x(parcelT(ground)), y(ground)], [x(parcelT(Math.min(ceil, topClamped))), y(Math.min(ceil, topClamped))]], 'rgba(240,220,120,0.95)', 1.6, '3 2');
  // markers: cloudbase (blue) and ceiling (grey), dashed horizontals + labels
  const hline = (alt: number, stroke: string, label: string): void => {
    if (alt <= ground || alt >= topClamped) return;
    svg.appendChild(el('line', { x1: PL, y1: y(alt), x2: W - PR, y2: y(alt), stroke, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
    const tx = el('text', { x: W - PR, y: y(alt) - 2, 'text-anchor': 'end', fill: stroke, 'font-size': 9 });
    tx.textContent = `${label} ${Math.round(alt)} m`; svg.appendChild(tx);
  };
  if (base != null) hline(base, 'rgba(120,170,235,0.95)', t('dayBase'));
  hline(ceil, 'rgba(220,220,220,0.85)', t('dayCeiling'));

  // one-line summary
  const depth = Math.max(0, Math.round(ceil - ground));
  const isCu = base != null && ceil >= base + 80;
  const sum = document.createElement('div');
  sum.style.cssText = 'font-size:11px;opacity:0.85;margin-top:2px';
  sum.textContent = `${t('dayDepth')} ${depth} m · ${isCu ? t('dayCu') : t('dayBlue')}`;

  host.appendChild(svg);
  host.appendChild(sum);
}
