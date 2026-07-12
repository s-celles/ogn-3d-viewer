// ============ the lift-potential mixer: checkboxes + a point in a component simplex =
// A checkbox per component enables it (makes it a vertex of the mixer). The enabled
// components form a simplex — a point on an axis for 2, a triangle for 3, a regular
// N-gon beyond — and the point's generalized-barycentric coordinates are the blend
// weights (normalised, Σ=1 over the enabled ones), stored in S.liftMix. Toggling a
// checkbox rebuilds the mixer to match. Generalises to any number of components.
import { S } from './state';
import { t } from './i18n';
import { LIFT_COMPS } from './lift';
import { LIFT_COLORS, SINK_COLORS } from './core/liftviz';

const NS = 'http://www.w3.org/2000/svg';
const rgb = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// Keep the state arrays the right length (a stored setting from an older version, or
// with fewer components, is padded rather than breaking the mixer).
function ensureArrays(): void {
  if (!Array.isArray(S.liftOn)) (S as any).liftOn = [];
  if (!Array.isArray(S.liftMix)) (S as any).liftMix = [];
  while (S.liftOn.length < LIFT_COMPS.length) S.liftOn.push(true);
  while (S.liftMix.length < LIFT_COMPS.length) S.liftMix.push(0);
}
// Indices of the enabled components (always at least one).
function enabled(): number[] {
  ensureArrays();
  const e = LIFT_COMPS.map((_, i) => i).filter(i => S.liftOn[i] !== false);
  return e.length ? e : LIFT_COMPS.map((_, i) => i);
}

// Box + geometry for n vertices.
function geom(n: number): { W: number; H: number; CX: number; CY: number; R: number } {
  return n >= 3 ? { W: 264, H: 226, CX: 132, CY: 106, R: 70 } : { W: 264, H: 96, CX: 132, CY: 40, R: 92 };
}
// Vertex positions for the enabled set: single point, horizontal segment, or polygon.
function verts(n: number, G: { CX: number; CY: number; R: number }): [number, number][] {
  if (n <= 1) return [[G.CX, G.CY]];
  if (n === 2) return [[G.CX - G.R, G.CY], [G.CX + G.R, G.CY]];
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [G.CX + G.R * Math.cos(a), G.CY + G.R * Math.sin(a)] as [number, number];
  });
}

// Generalized-barycentric weights (Σ=1) of a point inside the simplex: linear on a
// segment (n=2), mean-value coordinates (Floater) for a convex polygon (n≥3).
function weightsFromPoint(px: number, py: number, V: [number, number][]): number[] {
  const n = V.length;
  if (n <= 1) return [1];
  if (n === 2) {
    const [ax, ay] = V[0], [bx, by] = V[1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const ti = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    return [1 - ti, ti];
  }
  const eps = 1e-6;
  const s = V.map(([vx, vy]) => [vx - px, vy - py] as [number, number]);
  const r = s.map(([x, y]) => Math.hypot(x, y));
  for (let i = 0; i < n; i++) if (r[i] < eps) { const w = new Array(n).fill(0); w[i] = 1; return w; }
  const tan = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = s[i][0] * s[j][1] - s[i][1] * s[j][0];
    const D = s[i][0] * s[j][0] + s[i][1] * s[j][1];
    tan[i] = Math.abs(A) < eps ? 0 : (r[i] * r[j] - D) / A;
  }
  const w = new Array<number>(n); let sum = 0;
  for (let i = 0; i < n; i++) { w[i] = Math.max(0, (tan[(i + n - 1) % n] + tan[i]) / r[i]); sum += w[i]; }
  return sum > 0 ? w.map(x => x / sum) : new Array(n).fill(1 / n);
}
// Handle position from weights: the affine combination Σ wᵢ·Vᵢ — always inside.
function pointFromWeights(w: number[], V: [number, number][]): [number, number] {
  let x = 0, y = 0, s = 0;
  for (let i = 0; i < V.length; i++) { const wi = Math.max(0, w[i] || 0); x += wi * V[i][0]; y += wi * V[i][1]; s += wi; }
  return s > 0 ? [x / s, y / s] : [V[0] ? V[0][0] : 0, V[0] ? V[0][1] : 0];
}
// Clamp a drag point into the simplex: inside → unchanged; outside → the nearest point
// on the boundary (so the handle stays on the edge you drag toward, instead of the
// mean-value weights going negative and snapping it to the opposite vertex). Nudged a
// hair toward the centroid to keep the barycentric coordinates non-degenerate on edges.
function clampToSimplex(px: number, py: number, V: [number, number][]): [number, number] {
  const n = V.length;
  if (n <= 1) return [V[0][0], V[0][1]];
  const seg = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    return [ax + t * dx, ay + t * dy];
  };
  if (n === 2) return seg(V[0][0], V[0][1], V[1][0], V[1][1]);
  let pos = false, neg = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = (V[j][0] - V[i][0]) * (py - V[i][1]) - (V[j][1] - V[i][1]) * (px - V[i][0]);
    if (cr > 1e-6) pos = true; else if (cr < -1e-6) neg = true;
  }
  if (!(pos && neg)) return [px, py];   // inside (all cross-products same sign)
  let best: [number, number] = [px, py], bd = Infinity;
  for (let i = 0; i < n; i++) {
    const q = seg(V[i][0], V[i][1], V[(i + 1) % n][0], V[(i + 1) % n][1]);
    const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  let cx = 0, cy = 0; for (const [vx, vy] of V) { cx += vx; cy += vy; } cx /= n; cy /= n;
  return [best[0] + 0.02 * (cx - best[0]), best[1] + 0.02 * (cy - best[1])];
}

// ---- live widget state ----
let cont: HTMLElement | null = null;
let onChange: () => void = () => { };
let builtKey = '';
let EN: number[] = [], VV: [number, number][] = [], G = geom(3);
let handle: SVGCircleElement | null = null;
let labelEls: SVGTextElement[] = [], pctEls: SVGTextElement[] = [];
let cbInputs: HTMLInputElement[] = [], cbSpans: HTMLElement[] = [];
let calibCb: HTMLInputElement | null = null, calibSpan: HTMLElement | null = null;
let legSink: HTMLElement | null = null, legLift: HTMLElement | null = null, legVz: HTMLElement | null = null;

// Enable/disable a component, preserving the others' relative blend: a re-enabled one
// enters as a peer (the mean weight), a disabled one drops to 0. Never all-off.
function toggle(i: number, on: boolean): void {
  if (!on && enabled().length <= 1) { if (cbInputs[i]) cbInputs[i].checked = true; return; }
  S.liftOn[i] = on;
  if (!on) S.liftMix[i] = 0;
  else {
    const others = enabled().filter(x => x !== i);
    const mean = others.length ? others.reduce((a, x) => a + Math.max(0, S.liftMix[x] || 0), 0) / others.length : 1;
    S.liftMix[i] = mean > 0 ? mean : 1;
  }
  rebuild();
  onChange();
}

// Reset the blend to an equal split across the enabled components (centroid).
function recenter(): void {
  const en = enabled(); if (en.length < 2) return;
  const full = new Array(LIFT_COMPS.length).fill(0);
  en.forEach(ci => { full[ci] = 1 / en.length; });
  S.liftMix = full;
  updateDynamic();
  onChange();
}

// Update the parts that change without a structural rebuild: handle position, live
// percentages, labels (language) and checkbox states.
function updateDynamic(): void {
  if (!handle) return;
  const [hx, hy] = pointFromWeights(EN.map(ci => Math.max(0, S.liftMix[ci] || 0)), VV);
  handle.setAttribute('cx', String(hx)); handle.setAttribute('cy', String(hy));
  EN.forEach((ci, k) => {
    labelEls[k].textContent = t(LIFT_COMPS[ci].ik);
    const wsum = EN.reduce((a, x) => a + Math.max(0, S.liftMix[x] || 0), 0);
    pctEls[k].textContent = Math.round((wsum > 0 ? Math.max(0, S.liftMix[ci] || 0) / wsum : 0) * 100) + '%';
  });
  cbInputs.forEach((cb, i) => { cb.checked = S.liftOn[i] !== false; });
  cbSpans.forEach((sp, i) => { sp.textContent = t(LIFT_COMPS[i].ik); });
  if (calibCb) calibCb.checked = !!S.liftCalibrate;
  if (calibSpan) calibSpan.textContent = t('liftCalibrate');
  if (legSink) legSink.textContent = t('legendSink');
  if (legLift) legLift.textContent = t('legendLift');
  if (legVz) legVz.textContent = t('legendVz');
}

// Build the SVG simplex (outline, vertex dots + labels + percentages, drag handle).
function buildSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${G.W} ${G.H}`);
  svg.style.cssText = `width:100%;max-width:${G.W}px;height:auto;display:block;touch-action:none;cursor:pointer;user-select:none`;
  const n = EN.length;

  if (n >= 2) {
    const shape = document.createElementNS(NS, n === 2 ? 'line' : 'polygon');
    if (n === 2) {
      shape.setAttribute('x1', String(VV[0][0])); shape.setAttribute('y1', String(VV[0][1]));
      shape.setAttribute('x2', String(VV[1][0])); shape.setAttribute('y2', String(VV[1][1]));
    } else {
      shape.setAttribute('points', VV.map(([x, y]) => `${x},${y}`).join(' '));
      shape.setAttribute('fill', 'rgba(255,255,255,0.05)');
    }
    shape.setAttribute('stroke', 'rgba(255,255,255,0.5)'); shape.setAttribute('stroke-width', '1.75');
    svg.appendChild(shape);
  }

  const mkText = (x: number, y: number, fill: string, size: number): SVGTextElement => {
    const el = document.createElementNS(NS, 'text');
    el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
    el.setAttribute('text-anchor', 'middle'); el.setAttribute('fill', fill); el.setAttribute('font-size', String(size));
    svg.appendChild(el); return el;
  };

  labelEls = []; pctEls = [];
  VV.forEach(([x, y], k) => {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)); dot.setAttribute('r', '5');
    dot.setAttribute('fill', rgb(LIFT_COMPS[EN[k]].color)); dot.setAttribute('stroke', 'rgba(0,0,0,0.5)');
    svg.appendChild(dot);
    // Label + percentage stacked outward from each dot, middle-anchored and x-clamped
    // so even a long word ("Convergence") stays inside the box on every vertex.
    const lx = clamp(x, 48, G.W - 48);
    const ly = n >= 3 ? y + (y < G.CY ? -24 : 18) : G.CY + 26;
    labelEls.push(mkText(lx, ly, 'rgba(255,255,255,0.9)', 13));
    pctEls.push(mkText(lx, ly + 14, rgb(LIFT_COMPS[EN[k]].color), 12));
  });

  handle = document.createElementNS(NS, 'circle');
  handle.setAttribute('r', '8'); handle.setAttribute('fill', 'rgba(255,255,255,0.95)');
  handle.setAttribute('stroke', '#111'); handle.setAttribute('stroke-width', '1.5');
  if (n < 2) handle.setAttribute('opacity', '0');   // nothing to drag with a single component
  svg.appendChild(handle);

  const set = (ev: PointerEvent): void => {
    if (n < 2) return;
    const rect = svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) / rect.width * G.W, py = (ev.clientY - rect.top) / rect.height * G.H;
    const [cx, cy] = clampToSimplex(px, py, VV);   // keep the handle on the edge dragged toward
    const w = weightsFromPoint(cx, cy, VV);
    const full = new Array(LIFT_COMPS.length).fill(0);
    EN.forEach((ci, k) => { full[ci] = w[k]; });
    S.liftMix = full;
    updateDynamic();
    onChange();
  };
  let dragging = false;
  svg.addEventListener('pointerdown', e => { dragging = true; svg.setPointerCapture(e.pointerId); set(e); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (dragging) set(e); });
  svg.addEventListener('pointerup', e => { dragging = false; try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ } });

  // small ↺ reset button (top-right) — recenter to an equal split
  if (n >= 2) {
    const rg = document.createElementNS(NS, 'g'); rg.style.cursor = 'pointer';
    const title = document.createElementNS(NS, 'title'); title.textContent = t('liftReset'); rg.appendChild(title);
    const rc = document.createElementNS(NS, 'circle');
    rc.setAttribute('cx', String(G.W - 15)); rc.setAttribute('cy', '15'); rc.setAttribute('r', '11');
    rc.setAttribute('fill', 'rgba(255,255,255,0.08)'); rc.setAttribute('stroke', 'rgba(255,255,255,0.3)');
    const rt = document.createElementNS(NS, 'text');
    rt.setAttribute('x', String(G.W - 15)); rt.setAttribute('y', '20'); rt.setAttribute('text-anchor', 'middle');
    rt.setAttribute('fill', 'rgba(255,255,255,0.8)'); rt.setAttribute('font-size', '15'); rt.textContent = '↺';
    rg.append(rc, rt);
    rg.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); recenter(); });
    svg.appendChild(rg);
  }
  return svg;
}

// Full structural (re)build: checkbox row + SVG for the current enabled set.
function rebuild(): void {
  if (!cont) return;
  EN = enabled(); G = geom(EN.length); VV = verts(EN.length, G); builtKey = EN.join(',');
  cont.textContent = ''; cont.style.display = 'block';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 16px;margin:2px 0 8px';
  cbInputs = []; cbSpans = [];
  LIFT_COMPS.forEach((c, i) => {
    const lab = document.createElement('label'); lab.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = S.liftOn[i] !== false;
    cb.onchange = () => toggle(i, cb.checked);
    const sp = document.createElement('span'); sp.textContent = t(c.ik);
    lab.append(cb, sp); row.appendChild(lab);
    cbInputs.push(cb); cbSpans.push(sp);
  });
  cont.appendChild(row);
  cont.appendChild(buildSvg());

  // "Calibrate on tracks" — opt-in day-scale factor from the observed climbs.
  const calibLab = document.createElement('label');
  calibLab.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;margin-top:6px;font-size:13px;opacity:0.85';
  calibLab.title = t('liftCalibrateHint');
  calibCb = document.createElement('input'); calibCb.type = 'checkbox'; calibCb.checked = !!S.liftCalibrate;
  calibCb.onchange = () => { S.liftCalibrate = calibCb!.checked; onChange(); };
  calibSpan = document.createElement('span'); calibSpan.textContent = t('liftCalibrate');
  calibLab.append(calibCb, calibSpan);
  cont.appendChild(calibLab);

  // Colour legend: the shared ramp (deep sink → weak → strong lift) + a Vz anchor.
  const leg = document.createElement('div'); leg.style.cssText = 'margin-top:10px;font-size:11px;opacity:0.9';
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;height:12px;border-radius:3px;overflow:hidden';
  for (const c of [...SINK_COLORS].reverse().concat(LIFT_COLORS)) {
    const s = document.createElement('div'); s.style.cssText = `flex:1;background:rgb(${c[0]},${c[1]},${c[2]})`; bar.appendChild(s);
  }
  const ends = document.createElement('div'); ends.style.cssText = 'display:flex;justify-content:space-between;margin-top:2px';
  legSink = document.createElement('span'); legSink.textContent = t('legendSink');
  legLift = document.createElement('span'); legLift.textContent = t('legendLift');
  ends.append(legSink, legLift);
  legVz = document.createElement('div'); legVz.style.cssText = 'margin-top:2px;opacity:0.7'; legVz.textContent = t('legendVz');
  leg.append(bar, ends, legVz);
  cont.appendChild(leg);

  updateDynamic();
}

/** Reflect state into the mixer: a structural rebuild if the enabled set changed
 *  (e.g. after reset-to-defaults), else a light update of handle/percentages/labels. */
export function syncLiftMixer(): void {
  if (!cont) return;
  if (enabled().join(',') !== builtKey) rebuild(); else updateDynamic();
}

/** Build the mixer (checkboxes + simplex) into `container`; `cb` fires on any change. */
export function buildLiftMixer(container: HTMLElement, cb: () => void): void {
  cont = container; onChange = cb;
  rebuild();
}
