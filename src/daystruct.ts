// ============ day-structure panel: a mini emagram of the convective day ===========
// A compact vertical diagram at the current hour: the environmental temperature
// sounding, the surface parcel's dry adiabat (whose crossing sets the thermal
// ceiling), the cloudbase (LCL) and the ceiling — plus a one-line summary (convective
// depth, cumulus vs blue). Helps read WHY the thermal field looks the way it does.
// The atmosphere it draws (sounding interpolation, parcel adiabat, the day's summary)
// is domain code from core/weather.ts; this module only turns it into an SVG.
import { S } from './state';
import { t } from './i18n';
import { getWeather, weatherSounding, envT, parcelT, daySummary } from './weather';

const W = 214, H = 150;                 // svg box
const PL = 8, PR = 8, PT = 10, PB = 10; // plot margins
const NS = 'http://www.w3.org/2000/svg';
const el = (n: string, a: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, String(a[k]));
  return e;
};

let sig = '';
/** Draw / refresh the panel into `host` for the current view, hour and weather. Clears
 *  it when the lift potential is off or no sounding is available. Cheap: redraws only
 *  when the hour, weather-readiness or day type actually change. */
export function updateDayStruct(host: HTMLElement): void {
  const cLat = S.mapVS.latitude, cLon = S.mapVS.longitude;
  const wx = S.thermalPot && (S.wxSim.on || (S.source !== 'file' && S.date))
    ? getWeather(Math.round(cLat / 0.1) * 0.1, Math.round(cLon / 0.1) * 0.1, S.date) : null;
  const hour = S.wxSim.on ? Math.floor(S.wxSim.hour) : Math.floor((S.G0 + S.cur) / 3600);
  const s = wx ? weatherSounding(wx, hour) : null;
  const key = !S.thermalPot ? 'off' : s ? `${S.wxSim.on ? 'sim' : ''}${hour}|${Math.round(s.ceiling)}|${Math.round(s.cloudbase ?? -1)}|${Math.round(s.t2m)}` : 'nowx';
  if (key === sig) return;
  sig = key;
  host.textContent = '';
  if (!S.thermalPot || !s) return;

  const ground = s.ref, ceil = s.ceiling, base = s.cloudbase;
  const top = Math.max(ceil, base ?? 0, ground + 800) + 300;
  const topClamped = Math.min(top, s.tprof[s.tprof.length - 1].alt);   // don't extrapolate the env line
  // temperature range over what we draw (env + parcel)
  const parcel = (alt: number): number => parcelT(s, alt);
  let tMin = Infinity, tMax = -Infinity;
  for (let a = ground; a <= topClamped + 1; a += (topClamped - ground) / 10) {
    tMin = Math.min(tMin, envT(s, a), parcel(a)); tMax = Math.max(tMax, envT(s, a), parcel(a));
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
  poly([[x(parcel(ground)), y(ground)], [x(parcel(Math.min(ceil, topClamped))), y(Math.min(ceil, topClamped))]], 'rgba(240,220,120,0.95)', 1.6, '3 2');
  // altitude scale: ground and top ticks (left)
  const alt = (a: number, yy: number, anchor: string): void => {
    const tx = el('text', { x: PL, y: yy, 'text-anchor': anchor, fill: 'rgba(255,255,255,0.45)', 'font-size': 9 });
    tx.textContent = `${Math.round(a)} m`; svg.appendChild(tx);
  };
  alt(ground, H - PB - 2, 'start'); alt(topClamped, PT + 8, 'start');
  // markers: cloudbase (blue) and ceiling (grey), dashed horizontals + labels — the
  // altitude is clamped into the plot (a ceiling above the sounding data sits at the top).
  const hline = (a: number, stroke: string, label: string): void => {
    const ay = y(Math.max(ground, Math.min(topClamped, a)));
    svg.appendChild(el('line', { x1: PL, y1: ay, x2: W - PR, y2: ay, stroke, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
    const tx = el('text', { x: W - PR, y: ay - 2, 'text-anchor': 'end', fill: stroke, 'font-size': 9 });
    tx.textContent = `${label} ${a >= topClamped ? '≥' : ''}${Math.round(Math.min(a, topClamped))} m`; svg.appendChild(tx);
  };
  if (base != null && base > ground) hline(base, 'rgba(120,170,235,0.95)', t('dayBase'));
  hline(ceil, 'rgba(220,220,220,0.85)', t('dayCeiling'));

  // one-line summary (≥ when the parcel is still buoyant at the top of the sounding)
  const { depth, isCu, openTop } = daySummary(s);
  const sum = document.createElement('div');
  sum.style.cssText = 'font-size:11px;opacity:0.85;margin-top:2px';
  sum.textContent = `${t('dayDepth')} ${openTop ? '≥' : ''}${depth} m · ${isCu ? t('dayCu') : t('dayBlue')}`;

  host.appendChild(svg);
  host.appendChild(sum);
}
