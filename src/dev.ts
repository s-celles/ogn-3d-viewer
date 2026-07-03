// ============ developer mode (?dev=1) ============
// A tuning/debug panel + a small HUD, built entirely in JS (labels in English —
// this is a developer tool, not user-facing) and shown only when S.dev.on. All
// state lives in S.dev, so it persists via the settings system like everything
// else. Terrain-affecting knobs rebuild the TileLayer; the rest just re-render.
import { S } from './state';
import { render } from './render';
import { makeTerrain, terrainCacheSize } from './terrain';

const rebuildTerrain = (): void => { S.terrainInst = makeTerrain(); render(); };

let panel: HTMLElement | null = null;
let hud: HTMLElement | null = null;
let fps = 60, sinceCount = 0, swTiles = 0, swMB = 0;

// ---- tiny DOM builders ----
function toggle(label: string, get: () => boolean, set: (v: boolean) => void, onChange: () => void): HTMLElement {
  const row = document.createElement('div'); row.className = 'row spread'; row.style.margin = '2px 0';
  const l = document.createElement('span'); l.className = 'lbl'; l.style.margin = '0'; l.textContent = label;
  const b = document.createElement('button'); const paint = () => { b.textContent = get() ? 'On' : 'Off'; b.classList.toggle('on', get()); };
  b.onclick = () => { set(!get()); paint(); onChange(); }; paint();
  row.append(l, b); return row;
}
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, onChange: () => void): HTMLElement {
  const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;margin:2px 0';
  const l = document.createElement('label'); l.className = 'lbl';
  const val = document.createElement('b'); val.textContent = String(get());
  l.textContent = label + ' : '; l.appendChild(val);
  const inp = document.createElement('input'); inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(get());
  inp.addEventListener('input', () => { set(parseFloat(inp.value)); val.textContent = inp.value; onChange(); });
  row.append(l, inp); return row;
}

function buildPanel(): void {
  const host = document.getElementById('controls') || document.getElementById('panel');
  if (!host) return;
  const d = S.dev;
  panel = document.createElement('div'); panel.className = 'devpanel';
  panel.style.cssText = 'margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,220,0,.35)';
  const h = document.createElement('div'); h.className = 'lbl'; h.style.cssText = 'color:#ffdc00;font-weight:700;margin:0 0 4px';
  h.textContent = 'DEV'; panel.appendChild(h);

  panel.append(
    toggle('Terrain wireframe', () => d.wireframe, v => d.wireframe = v, rebuildTerrain),
    toggle('Bare relief (no imagery)', () => d.noTexture, v => d.noTexture = v, rebuildTerrain),
    toggle('Tile skirts', () => d.skirts, v => d.skirts = v, rebuildTerrain),
    toggle('Tile bounds + z/x/y', () => d.tileBounds, v => d.tileBounds = v, rebuildTerrain),
    toggle('FPS overlay', () => d.fps, v => d.fps = v, syncHud),
    toggle('Cache counters', () => d.counters, v => d.counters = v, syncHud),
    slider('Max requests', 1, 32, 1, () => d.maxRequests, v => d.maxRequests = v, rebuildTerrain),
    slider('Mesh grid N', 16, 128, 8, () => d.gridN, v => d.gridN = v, rebuildTerrain),
    slider('Deck cache size', 100, 1200, 50, () => d.deckCache, v => d.deckCache = v, rebuildTerrain),
    slider('Far plane (km)', 20, 300, 10, () => d.farKm, v => d.farKm = v, render),
  );
  const off = document.createElement('button'); off.textContent = '✕ Exit dev mode'; off.style.marginTop = '6px';
  off.onclick = disableDev; panel.appendChild(off);
  host.appendChild(panel);
}

function buildHud(): void {
  hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:8px;left:8px;z-index:50;font:11px/1.4 monospace;color:#ffdc00;' +
    'background:rgba(0,0,0,.6);padding:4px 7px;border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(hud);
  syncHud();
}
function syncHud(): void { if (hud) hud.style.display = (S.dev.on && (S.dev.fps || S.dev.counters)) ? 'block' : 'none'; }

export function initDev(): void {
  document.body.classList.toggle('dev', S.dev.on);
  if (!S.dev.on) return;
  buildPanel(); buildHud();
}

function disableDev(): void {
  S.dev.on = false;
  panel?.remove(); hud?.remove(); panel = hud = null;
  document.body.classList.remove('dev');
  render();   // persists the change via saveSettings
}

// Called every animation frame from main.ts.
export function devFrame(dt: number): void {
  if (!S.dev.on || !hud || (!S.dev.fps && !S.dev.counters)) return;
  if (dt > 0) fps = fps * 0.9 + (1 / dt) * 0.1;
  if (++sinceCount >= 30) {   // refresh the (async) cache counters ~twice a second
    sinceCount = 0;
    try { if (typeof caches !== 'undefined') caches.open('ogn-tiles-v1').then(c => c.keys()).then(k => { swTiles = k.length; }).catch(() => {}); } catch { /* ignore */ }
    try { navigator.storage?.estimate?.()?.then(e => { swMB = Math.round((e.usage || 0) / 1048576); }).catch(() => {}); } catch { /* ignore */ }
  }
  const lines: string[] = [];
  if (S.dev.fps) lines.push(`${fps.toFixed(0)} fps  ${(dt * 1000).toFixed(1)} ms`);
  if (S.dev.counters) lines.push(`DEM cache: ${terrainCacheSize()}`, `disk: ${swTiles} tiles ~${swMB} MB`);
  hud.textContent = lines.join('\n');
}
