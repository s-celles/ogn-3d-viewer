// ============ the lift-potential mixer: a draggable point in a component simplex ==
// 2 components → a point on an axis; 3 → in a triangle; N → in a regular N-gon. The
// point's generalized-barycentric coordinates are the blend weights, stored
// (normalised, Σ=1) in S.liftMix. Dragging near a vertex favours that component; the
// centre is an even blend. Each vertex shows its component's live share (%). The SVG
// scales to the panel width and keeps all its content inside the viewBox, so nothing
// is clipped. Generalises to any number of components (see lift.ts).
import { S } from './state';
import { t } from './i18n';
import { LIFT_COMPS, liftWeight } from './lift';

const N = LIFT_COMPS.length;
const NS = 'http://www.w3.org/2000/svg';
const rgb = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// Box (viewBox units) and simplex geometry, chosen so labels + percentages fit inside.
const W = N === 2 ? 260 : 224, H = N === 2 ? 96 : 208;
const CX = W / 2, CY = N === 2 ? 40 : 92, R = N === 2 ? 92 : 62;

// Vertex positions (svg coords): a horizontal segment for N=2, a regular polygon
// (first vertex at the top) for N≥3.
function verts(): [number, number][] {
  if (N <= 1) return [[CX, CY]];
  if (N === 2) return [[CX - R, CY], [CX + R, CY]];
  return LIFT_COMPS.map((_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / N;
    return [CX + R * Math.cos(a), CY + R * Math.sin(a)] as [number, number];
  });
}

// Generalized-barycentric weights (Σ=1) of a point inside the vertex simplex: linear
// on a segment (N=2), mean-value coordinates (Floater) for a convex polygon (N≥3).
// Clamped to non-negative + renormalised, so a point dragged outside stays a valid
// blend (and the handle snaps back inside via pointFromWeights).
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
    const A = s[i][0] * s[j][1] - s[i][1] * s[j][0];     // 2·signed triangle area at p
    const D = s[i][0] * s[j][0] + s[i][1] * s[j][1];
    tan[i] = Math.abs(A) < eps ? 0 : (r[i] * r[j] - D) / A;   // tan(½·angle p subtends over edge i)
  }
  const w = new Array<number>(n); let sum = 0;
  for (let i = 0; i < n; i++) { w[i] = Math.max(0, (tan[(i + n - 1) % n] + tan[i]) / r[i]); sum += w[i]; }
  return sum > 0 ? w.map(x => x / sum) : new Array(n).fill(1 / n);
}

// Handle position from weights: the affine combination Σ wᵢ·Vᵢ (Σw=1) — always inside.
function pointFromWeights(w: number[], V: [number, number][]): [number, number] {
  let x = 0, y = 0, s = 0;
  for (let i = 0; i < V.length; i++) { const wi = Math.max(0, w[i] || 0); x += wi * V[i][0]; y += wi * V[i][1]; s += wi; }
  return s > 0 ? [x / s, y / s] : [CX, CY];
}

const V = verts();
let handle: SVGCircleElement | null = null;
let labelEls: SVGTextElement[] = [];
let pctEls: SVGTextElement[] = [];

/** Reflect S.liftMix into the handle position, the vertex labels (for a language
 *  switch) and the live percentages. No-op until the mixer is built. */
export function syncLiftMixer(): void {
  if (!handle) return;
  const [hx, hy] = pointFromWeights(S.liftMix || [], V);
  handle.setAttribute('cx', String(hx)); handle.setAttribute('cy', String(hy));
  labelEls.forEach((el, i) => { el.textContent = t(LIFT_COMPS[i].ik); });
  pctEls.forEach((el, i) => { el.textContent = Math.round(liftWeight(LIFT_COMPS[i].key) * 100) + '%'; });
}

/** Build the simplex mixer into `container`, calling `onChange` whenever the blend
 *  moves (after writing the normalised weights back to S.liftMix). */
export function buildLiftMixer(container: HTMLElement, onChange: () => void): void {
  container.textContent = '';
  container.style.display = 'block';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = `width:100%;max-width:${W}px;height:auto;display:block;touch-action:none;cursor:pointer;user-select:none`;

  // simplex outline
  const shape = document.createElementNS(NS, N === 2 ? 'line' : 'polygon');
  if (N === 2) {
    shape.setAttribute('x1', String(V[0][0])); shape.setAttribute('y1', String(V[0][1]));
    shape.setAttribute('x2', String(V[1][0])); shape.setAttribute('y2', String(V[1][1]));
  } else {
    shape.setAttribute('points', V.map(([x, y]) => `${x},${y}`).join(' '));
    shape.setAttribute('fill', 'rgba(255,255,255,0.03)');
  }
  shape.setAttribute('stroke', 'rgba(255,255,255,0.35)'); shape.setAttribute('stroke-width', '1.5');
  svg.appendChild(shape);

  const mkText = (x: number, y: number, anchor: string, fill: string, size: number): SVGTextElement => {
    const el = document.createElementNS(NS, 'text');
    el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
    el.setAttribute('text-anchor', anchor); el.setAttribute('fill', fill); el.setAttribute('font-size', String(size));
    svg.appendChild(el); return el;
  };

  // vertices: swatch dot + label + live percentage, laid out to stay inside the box.
  labelEls = []; pctEls = [];
  V.forEach(([x, y], i) => {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)); dot.setAttribute('r', '4.5');
    dot.setAttribute('fill', rgb(LIFT_COMPS[i].color)); dot.setAttribute('stroke', 'rgba(0,0,0,0.5)');
    svg.appendChild(dot);
    // N=2: labels centred below the dots. N≥3: pushed radially outward from the centroid.
    let lx: number, ly: number, anchor: string, pctY: number;
    if (N === 2) { lx = x; ly = CY + 26; anchor = 'middle'; pctY = ly + 18; }
    else {
      const ux = (x - CX), uy = (y - CY), L = Math.hypot(ux, uy) || 1;
      lx = clamp(x + ux / L * 16, 26, W - 26); ly = y + uy / L * 15 + (uy < 0 ? -4 : 12);
      anchor = ux < -8 ? 'end' : ux > 8 ? 'start' : 'middle';
      pctY = ly + (uy < 0 ? -14 : 14);
    }
    labelEls.push(mkText(lx, ly, anchor, 'rgba(255,255,255,0.85)', 12));
    pctEls.push(mkText(lx, pctY, anchor, rgb(LIFT_COMPS[i].color), 11));
  });

  // draggable handle
  handle = document.createElementNS(NS, 'circle');
  handle.setAttribute('r', '7'); handle.setAttribute('fill', 'rgba(255,255,255,0.95)');
  handle.setAttribute('stroke', '#111'); handle.setAttribute('stroke-width', '1.5');
  svg.appendChild(handle);

  const set = (ev: PointerEvent): void => {
    const rect = svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) / rect.width * W, py = (ev.clientY - rect.top) / rect.height * H;
    S.liftMix = weightsFromPoint(px, py, V);
    syncLiftMixer();
    onChange();
  };
  let dragging = false;
  svg.addEventListener('pointerdown', e => { dragging = true; svg.setPointerCapture(e.pointerId); set(e); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (dragging) set(e); });
  svg.addEventListener('pointerup', e => { dragging = false; try { svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ } });

  container.appendChild(svg);
  syncLiftMixer();
}
