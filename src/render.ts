// ============ viewer: deck.gl instance, dynamic layers, HUD ============
import { S } from './state';
import { t } from './i18n';
import { mapDiv, sunEl, moonEl, labelsDiv, hudreg, hudhdg, hudspd, hudalt, hudvar, hudnetto, hudnettoK, hudsuper, hudsuperK, hudwindbarb, hudwindtxt, lglist, focusBadge } from './dom';
import {
  Deck, MapView, FirstPersonView, PathLayer, PolygonLayer, TripsLayer, ScatterplotLayer, SimpleMeshLayer, IconLayer,
  LightingEffect, AmbientLight, DirectionalLight, PathStyleExtension, PostProcessEffect, COORDINATE_SYSTEM,
} from './deck';
import { makeTerrain, terrainElevAt } from './terrain';
import { drawGraphs } from './graphs';
import { drawTraffic } from './traffic';
import { varioAudio } from './vario-audio';
import { updateSky, getSun, getMoon, nightPolygon, sceneMs } from './sky';
import { subjectTrack, shown, scaled, posAt, presence, airborne, isActive, headingAt, varioAt, compVarioAt, groundSpeedAt, clampCur, attitudeAt, nearestToCenter, displayReg } from './flight-math';
import { nettoAt, minSink } from './polar';
import { GLIDER_MESH, PLANE_MESH, PROP_MESH, GLIDER_FLAT, PLANE_FLAT, isPowered } from './aircraft-mesh';
import { getPeaks, getWaypoints, loadPeaks, type Poi } from './poi';
import { updateMinimap } from './minimap';
import { airMassLayers } from './airmass';
import { waveMassLayers } from './wavemass';
import { ridgeLayers, windAtAlt } from './ridge';
import { colLayers } from './cols';
import { convergLayers } from './converg';
import { waveLayers } from './wave';
import { liftWeight } from './lift';
import { windLayers } from './wind';
import { thermalLayers } from './thermal';
import { poiLabelsDiv } from './dom';
import { CHASE, FAR_PLANE } from './config';
import { saveSettings } from './settings';
import type { RGB, Pos3, RenderTrack } from './types';

// First-person/chase far plane — the dev-mode override when active, else the
// device-tiered default.
const farPlane = (): number => S.dev.on ? S.dev.farKm * 1000 : FAR_PLANE;

interface PathDatum { color: RGB; pts: Pos3[]; }
interface AircraftDatum { pos: Pos3; orient: [number, number, number]; c: RGB; offline: boolean; }

// Grey an offline (stale-fix) aircraft toward this tint so it reads as "not
// currently transmitting", like the FlightBook live map.
const OFFLINE_GREY: RGB = [120, 132, 150];
const greyed = (c: RGB, f: number): RGB =>
  [Math.round(c[0] + (OFFLINE_GREY[0] - c[0]) * f), Math.round(c[1] + (OFFLINE_GREY[1] - c[1]) * f), Math.round(c[2] + (OFFLINE_GREY[2] - c[2]) * f)];

const ambLight = new AmbientLight({ color: [255, 255, 255], intensity: 1.1 });
const sunLight = new DirectionalLight({ color: [255, 245, 225], intensity: 2.2, direction: [-0.6, -1, -0.5] });
const lighting = new LightingEffect({ amb: ambLight, sun: sunLight });

// Apply the time-of-day sun light (deck reads these each render).
function applySunLight(): void {
  const s = getSun();
  sunLight.direction = s.dir; sunLight.intensity = s.intensity; sunLight.color = s.color;
  ambLight.intensity = s.ambient;
}

// Keep an aircraft from rendering below the (coarse) terrain in steep mountains:
// if its lng/lat projects onto ground higher than its altitude, lift it to the
// surface. Uses only already-loaded tiles (null = no data → leave as-is).
function groundClamp(p: Pos3): number {
  const g = terrainElevAt(p[0], p[1]);
  return g != null && p[2] < g ? g : p[2];
}

// World-space Z for an aircraft MARKER. The glyph's metric size is fixed
// (MODEL_SCALE) while the aircraft↔terrain gap scales with the vertical
// exaggeration k, so at low k an oversized marker on a low pass sinks into the
// hill. Floor it a fraction of the marker size above the ground; high-flying
// aircraft keep their real (k-scaled) altitude.
function markerZ(p: Pos3, k: number, scale: number): number {
  const g = terrainElevAt(p[0], p[1]);
  const floor = g != null ? g * k + scale * 1.5 : -Infinity;
  return Math.max(p[2] * k, floor);
}

// Blend params for the flat (unlit, translucent) ground-shadow meshes: occluded
// by terrain in front, no depth write, normal alpha blend, both faces.
const shadowMeshParams = {
  depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
} as any;

// March the sun ray from [lon, lat, alt] along the light direction `dir`
// ([east, north, up], dir.z < 0) and return the FIRST terrain intersection — so
// the shadow lands correctly on slopes and a glider inside a mountain's shadow
// is handled. Works in world space (×k) so it matches the (exaggerated) terrain.
// Returns [lon, lat, terrainZ*k] or null (no hit / no tiles).
function rayShadow(lon: number, lat: number, alt: number, dir: number[], k: number): Pos3 | null {
  if (dir[2] >= -0.03) return null;                                  // sun at/below horizon
  const gBelow = terrainElevAt(lon, lat); if (gBelow == null) return null;
  const cosLat = Math.cos(lat * Math.PI / 180), mLng = 111320 * cosLat, mLat = 111320, z0 = alt * k;
  const at = (t: number): Pos3 => [lon + t * dir[0] / mLng, lat + t * dir[1] / mLat, 0];
  const maxT = Math.min(60000, (z0 - gBelow * k + 1500) / Math.abs(dir[2])), step = 30;
  let prevT = 0;
  for (let t = step, n = 0; t < maxT && n < 260; t += step, n++) {
    const q = at(t), terr = terrainElevAt(q[0], q[1]);
    if (terr == null) { prevT = t; continue; }
    if (z0 + t * dir[2] <= terr * k) {                               // ray dropped to/under the terrain → refine
      let lo = prevT, hi = t;
      for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2, mq = at(m), mt = terrainElevAt(mq[0], mq[1]); if (mt != null && z0 + m * dir[2] <= mt * k) hi = m; else lo = m; }
      const f = at(hi), ft = terrainElevAt(f[0], f[1]);
      return ft == null ? null : [f[0], f[1], ft * k];
    }
    prevT = t;
  }
  return null;
}

// Ground point where a point at [lon, lat, alt] casts its shadow: straight down
// (nadir), or — when useSun — ray-marched along the sun direction onto the
// terrain (with a flat-ground single-step fallback). Returns [lon,lat,z*k]|null.
function shadowGround(lon: number, lat: number, alt: number, useSun: boolean, dir: number[], k: number): Pos3 | null {
  if (useSun) {
    const r = rayShadow(lon, lat, alt, dir, k); if (r) return r;
    const gBelow = terrainElevAt(lon, lat); if (gBelow == null) return null;   // fallback: flat-ground offset
    const agl = Math.max(0, alt - gBelow), t = Math.min(agl / Math.abs(dir[2]), agl * 6), cosLat = Math.cos(lat * Math.PI / 180);
    const slon = lon + t * dir[0] / (111320 * cosLat), slat = lat + t * dir[1] / 111320, sg = terrainElevAt(slon, slat);
    return sg == null ? null : [slon, slat, sg * k];
  }
  const g = terrainElevAt(lon, lat);
  return g == null ? null : [lon, lat, g * k];
}

// Vertical "altitude curtain" mesh: a ribbon whose top edge is the track and
// bottom edge is the terrain straight below — drawn translucent so height over
// the ground reads at a glance. dp = decimated track points [lon,lat,alt,t].
const CURTAIN_ANCHOR = [{}];
function altCurtainMesh(dp: number[][], k: number): any {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const rp of dp) {
    const gg = terrainElevAt(rp[0], rp[1]);
    pos.push(rp[0], rp[1], rp[2] * k); nrm.push(0, 0, 1);                       // top (on the track)
    pos.push(rp[0], rp[1], (gg != null ? gg : rp[2]) * k); nrm.push(0, 0, 1);  // bottom (on the ground)
  }
  for (let i = 0; i < dp.length - 1; i++) { const t0 = i * 2; idx.push(t0, t0 + 1, t0 + 2, t0 + 2, t0 + 1, t0 + 3); }
  if (idx.length < 3) return null;
  return { attributes: { POSITION: { value: new Float32Array(pos), size: 3 }, NORMAL: { value: new Float32Array(nrm), size: 3 } }, indices: { value: new Uint32Array(idx), size: 1 }, mode: 4 };
}

// ---- glide ("final glide") cone around the airfield ----
const CONE_ANCHOR = [{}];

// Minimum altitude (m, real) needed at lng/lat to reach the airfield at the
// current glide ratio + safety height. An aircraft above it is "local".
function glideFloor(lon: number, lat: number): number {
  const af = S.AF!;
  const cosLat = Math.cos(af.lat * Math.PI / 180);
  const dE = (lon - af.lon) * 111320 * cosLat, dN = (lat - af.lat) * 111320;
  return af.elev + S.safetyHeight + Math.hypot(dE, dN) / S.glideRatio;
}
function reachable(tr: RenderTrack): boolean {
  if (!S.AF || !airborne(tr, S.cur)) return false;
  const p = posAt(tr, S.cur);
  return p[2] >= glideFloor(p[0], p[1]);
}

// The transparent glide cone (sloped surface + top-edge ring) centred on the
// airfield. Apex at elevation + safety height; radius grows by glideRatio per
// metre of altitude, up to the highest track's altitude.
function glideConeLayers(k: number): any[] {
  const af = S.AF; if (!af) return [];
  const base = af.elev + S.safetyHeight;
  const R = S.coneRadiusKm * 1000;                 // horizontal radius (m) the cone is drawn to
  const top = base + R / S.glideRatio;             // altitude at the rim (slope 1/finesse)
  if (R <= 0) return [];
  const N = 72, cosLat = Math.cos(af.lat * Math.PI / 180), mLng = 111320 * cosLat, mLat = 111320;
  const ring = (i: number): Pos3 => { const a = i / N * 2 * Math.PI; return [af.lon + R * Math.cos(a) / mLng, af.lat + R * Math.sin(a) / mLat, top * k]; };
  const apex: Pos3 = [af.lon, af.lat, base * k];
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let i = 0; i < N; i++) { const p1 = ring(i), p2 = ring((i + 1) % N); for (const p of [apex, p1, p2]) { idx.push(pos.length / 3); pos.push(p[0], p[1], p[2]); nrm.push(0, 0, 1); } }
  const mesh = { attributes: { POSITION: { value: new Float32Array(pos), size: 3 }, NORMAL: { value: new Float32Array(nrm), size: 3 } }, indices: { value: new Uint32Array(idx), size: 1 }, mode: 4 };
  const col = [90, 220, 140], ringPath: Pos3[] = []; for (let i = 0; i <= N; i++) ringPath.push(ring(i % N));
  return [
    new SimpleMeshLayer({
      id: 'glide-cone', data: CONE_ANCHOR, getPosition: () => [0, 0, 0], _instanced: false,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT, mesh: mesh as any, getColor: [...col, 26], material: false,
      parameters: {
        depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
        blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
      },
    } as any),
    new PathLayer({
      id: 'glide-cone-ring', data: [ringPath], getPath: (d: any) => d, getColor: [...col, 150],
      getWidth: 1.5, widthUnits: 'pixels', parameters: { depthCompare: 'less-equal', depthWriteEnabled: false } as any,
    } as any),
  ];
}

const dashExt = new PathStyleExtension({ dash: true });

// ---- trail visual effects (contrail sprite + bloom post-process) ----
// Soft round sprite (white, alpha falloff) used as a smoke puff; tinted per
// puff via IconLayer mask. Built once on first use.
let puffSprite: string | null = null;
function smokeSprite(): string {
  if (puffSprite) return puffSprite;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!, g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  puffSprite = c.toDataURL(); return puffSprite;
}

// Single-pass screen-space bloom: add a thresholded, slightly-blurred copy of
// the bright pixels back over the image, so the sun and luminous trails glow.
const BLOOM_FS = `
vec4 bloom_sampleColor(sampler2D source, vec2 texSize, vec2 texCoord) {
  vec4 c = texture(source, texCoord);
  vec3 glow = vec3(0.0);
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    for (int j = -3; j <= 3; j++) {
      vec2 off = vec2(float(i), float(j)) * 2.4 / texSize;
      float w = exp(-float(i * i + j * j) * 0.18);                 // gaussian falloff → soft halo
      glow += max(texture(source, texCoord + off).rgb - 0.62, 0.0) * w;
      wsum += w;
    }
  }
  return vec4(c.rgb + glow / wsum * 0.9, c.a);                     // normalised, so it adds a soft bloom not a wash
}
`;
let bloomFx: any = null;   // null = not yet built, undefined = build failed
function getBloom(): any {
  if (bloomFx !== null) return bloomFx;
  try { bloomFx = new PostProcessEffect({ name: 'bloom', fs: BLOOM_FS, passes: [{ sampler: 'bloom_sampleColor' }] } as any, {}); }
  catch { bloomFx = undefined; }
  return bloomFx;
}

// Split a track's [t0,t1] window into solid runs (real data) and dashed runs
// (reception-loss gaps, interpolated), sharing boundary points so they connect.
function splitPath(tr: RenderTrack, t0: number, t1: number, k: number): { solid: Pos3[][]; dashed: Pos3[][] } {
  const gaps = tr.gaps, solid: Pos3[][] = [], dashed: Pos3[][] = [];
  let cur: Pos3[] = [], gap = false, has = false, gi = 0;        // gaps & rel are time-sorted
  for (const p of tr.rel) {
    const tt = p[3];
    while (gi < gaps.length && gaps[gi][1] <= tt) gi++;          // advance past finished gaps
    if (tt < t0 || tt > t1) continue;
    const g = gi < gaps.length && tt > gaps[gi][0], pos: Pos3 = [p[0], p[1], p[2] * k];
    if (has && g !== gap) { cur.push(pos); (gap ? dashed : solid).push(cur); cur = [pos]; }
    else cur.push(pos);
    gap = g; has = true;
  }
  if (cur.length >= 2) (gap ? dashed : solid).push(cur);
  return { solid, dashed };
}
const pushPaths = (solidArr: PathDatum[], dashArr: PathDatum[], color: RGB, r: { solid: Pos3[][]; dashed: Pos3[][] }) => {
  for (const pts of r.solid) if (pts.length >= 2) solidArr.push({ color, pts });
  for (const pts of r.dashed) if (pts.length >= 2) dashArr.push({ color, pts });
};

// The glider/airfield/terrain layers, rebuilt every frame from the cursor.
// ---- points of interest (OSM summits + .cup waypoints): a pole + a label ----
const POLE_M = 70;   // pole ("piquet") height in metres, planted on the summit
// Per-category marker: a glyph (leading the DOM label) + a colour (pole + glyph).
// ︎ forces text (monochrome) presentation so ✈/✖ inherit the category colour.
const POI_STYLE: Record<string, { glyph: string; color: [number, number, number] }> = {
  summit:   { glyph: '▲',         color: [255, 110, 70] },   // ▲ orange
  airfield: { glyph: '✈︎',   color: [120, 210, 130] },  // ✈ green (landable, hard/grass)
  outland:  { glyph: '▽',         color: [235, 205, 90] },   // ▽ amber (landable field / vachable)
  obstacle: { glyph: '✕︎',   color: [255, 95, 95] },    // ✕ red (mast / tower / plant)
  landmark: { glyph: '◆',         color: [120, 190, 255] },  // ◆ blue (VOR, castle, turnpoint…)
};
const poiStyle = (p: Poi) => POI_STYLE[p.cat] || POI_STYLE.landmark;
function peakCount(): number { return Math.round(15 + S.peakDensity * S.peakDensity * 485); }   // density 0..1 → ~15..500 (highest first)
function viewCenter(): [number, number] {
  if (S.mode !== 'over') { const tr = subjectTrack(); if (tr) { const p = posAt(tr, clampCur(tr)); return [p[0], p[1]]; } }
  return [S.mapVS.longitude, S.mapVS.latitude];
}
// Fetch summits around wherever the view is now — refetch only when the centre
// crosses a 0.25° cell (the loader caches per bbox, so panning back is free).
let lastPeakKey = '';
let peakTimer: ReturnType<typeof setTimeout> | null = null;
function updatePeakFetch(): void {
  if (!S.ready || !S.showPeaks) { lastPeakKey = ''; return; }
  const [clon, clat] = viewCenter();
  const key = Math.round(clon * 4) + '|' + Math.round(clat * 4);
  if (key === lastPeakKey) return;
  lastPeakKey = key;
  const M = 0.6, lon = clon, lat = clat;
  if (peakTimer) clearTimeout(peakTimer);   // debounce: only fetch once the view settles on a cell
  peakTimer = setTimeout(() => loadPeaks(lon - M, lat - M, lon + M, lat + M).then(render), 300);
}
// Pick a spatially-spread subset of the (highest-first) peaks: greedy min-distance
// thinning so the label budget covers the whole view — otherwise the top-N by absolute
// elevation all pile into the highest massif and the nearer/lower terrain gets nothing.
// Memoised on the peak list + count (both change rarely), so it's free per frame.
let peakSpread: { ref: Poi[]; n: number; out: Poi[] } | null = null;
function spreadPeaks(all: Poi[], n: number): Poi[] {
  if (all.length <= n) return all;
  if (peakSpread && peakSpread.ref === all && peakSpread.n === n) return peakSpread.out;
  const cosl = Math.max(0.1, Math.cos(viewCenter()[1] * Math.PI / 180));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of all) { if (p.lon < minX) minX = p.lon; if (p.lon > maxX) maxX = p.lon; if (p.lat < minY) minY = p.lat; if (p.lat > maxY) maxY = p.lat; }
  const D2 = Math.max(1e-8, (maxX - minX) * cosl * (maxY - minY) / n) * 0.64;   // (~0.8× the target spacing)²
  const kept: Poi[] = [];
  for (const p of all) {   // highest first → the tallest peak in each neighbourhood wins its spot
    if (kept.length >= n) break;
    let ok = true;
    for (const q of kept) { const dx = (q.lon - p.lon) * cosl, dy = q.lat - p.lat; if (dx * dx + dy * dy < D2) { ok = false; break; } }
    if (ok) kept.push(p);
  }
  peakSpread = { ref: all, n, out: kept };
  return kept;
}
function activePois(): Poi[] {
  if (!S.showPeaks) return [];
  const peaks = spreadPeaks(getPeaks(), peakCount()), wps = getWaypoints();   // peaks are already area-local
  if (!wps.length) return peaks;
  const [clon, clat] = viewCenter(), R = 1.2;                              // a .cup can hold thousands → only render nearby
  return [...peaks, ...wps.filter(p => Math.abs(p.lon - clon) < R && Math.abs(p.lat - clat) < R)];
}
function poiPoleLayers(k: number): any[] {
  const pois = activePois(); if (!pois.length) return [];
  return [new PathLayer<Poi>({
    id: 'poi-poles', data: pois,
    getPath: (p: Poi) => [[p.lon, p.lat, p.ele * k], [p.lon, p.lat, (p.ele + POLE_M) * k]],
    getColor: (p: Poi) => [...poiStyle(p).color, 235] as [number, number, number, number],
    getWidth: 2.5, widthUnits: 'pixels', billboard: true,   // billboard: a vertical path is edge-on (invisible) otherwise
    parameters: { depthTest: true } as any, updateTriggers: { getPath: [S.exo], getColor: [S.showPeaks] },
  } as any)];
}

function dynamicLayers() {
  // Bail only when nothing is loaded. With an airfield but no flights (S.ready
  // false), the track work below all iterates an empty set, while the environment
  // overlays (weather sandbox wave/wind/thermals, glide cone, night bands…) still
  // render around the field — so the "what-if" sandbox works even on a flightless day.
  if (!S.ready && !S.AF) return [];
  const k = S.exo, vis = S.TRACKS.filter(shown), off = S.trace === 'off';
  const histStart = (tr: typeof vis[number]) => S.trace === 'window' ? Math.max(tr.rstart, S.cur - S.windowMin * 60) : tr.rstart;
  // Past/future trails split into solid (real data) and dashed (reception-loss
  // gaps, interpolated) runs.
  const pastData: PathDatum[] = [], pastGap: PathDatum[] = [], futData: PathDatum[] = [], futGap: PathDatum[] = [];
  if (!off) for (const tr of vis) {
    pushPaths(pastData, pastGap, tr.color, splitPath(tr, histStart(tr), S.cur, k));
    if (S.trace === 'histfut') pushPaths(futData, futGap, tr.color, splitPath(tr, S.cur, tr.rend, k));
  }
  // Per-view mesh scale (real size in chase, inflated marker elsewhere), user-tunable.
  const meshScale = S.modelScale[S.mode];
  const propSpin = (performance.now() * 0.8) % 360;   // propeller roll (deg), real-time

  // 3D aircraft models, oriented to the estimated attitude. deck orientation is
  // [pitch, yaw, roll] with the mesh frame +X=nose, +Y=left, +Z=up, so our
  // attitude maps to [-pitch, 90-heading, roll] (degrees).
  const aircraft = vis.map(tr => {
    if (S.mode === 'fpv' && tr.reg === S.subject) return null;
    const pr = presence(tr);
    if (!pr) return null;
    const p = posAt(tr, pr.time), a = attitudeAt(tr, pr.time), D = 180 / Math.PI;
    return {
      type: tr.type,
      pos: [p[0], p[1], markerZ(p, k, meshScale)] as Pos3,
      orient: [-a.pitch * D, 90 - a.heading, a.roll * D] as [number, number, number],
      c: tr.color, offline: pr.offline,
    };
  }).filter((d): d is AircraftDatum & { type: number } => d !== null);
  const gliders = aircraft.filter(d => !isPowered(d.type));
  const planes = aircraft.filter(d => isPowered(d.type));
  const aircraftMaterial = { ambient: 0.5, diffuse: 0.8, shininess: 24, specularColor: [40, 40, 40] };
  const pastAlpha = (S.mode === 'fpv' || S.solo) ? 215 : 165, trail = S.trace === 'window' ? S.windowMin * 60 : 240;
  // Day/night terminator overlay: darken the night side of the world so a
  // zoomed-out view isn't uniformly "night everywhere" (the scene's single sun
  // light can't show this on the flat map). Drawn over the terrain, under the
  // trails/aircraft.
  const ms = (S.date || S.wxSim.on) ? sceneMs() : NaN;
  // Stacked twilight bands (terminator, civil −6°, nautical −12°, astronomical
  // −18°) so the night edge reads as a soft dusk gradient rather than a hard line.
  const nightBands = (Number.isFinite(ms)
    ? [[0, 45], [-6, 45], [-12, 45], [-18, 50]].map(([alt, a]) => ({ poly: nightPolygon(ms, alt), a }))
    : []).filter(b => b.poly);
  // Overview focus ring: a halo in the glider's trace colour around the focus
  // candidate (the glider cockpit/chase will follow), so it's unmistakable on the map.
  const focusTr = S.mode === 'over' && S.focus ? vis.find(tr => tr.reg === S.focus) : null;
  // Soft additive "vapour" glow drawn under the crisp trail: a wide low-alpha
  // pass + a tighter brighter pass build a haloed neon ribbon without losing the
  // thin core line. Additive over the terrain so it reads as emitted light.
  const glowParams = {
    depthCompare: 'less-equal', depthWriteEnabled: false,   // occluded by terrain, but don't hide the crisp core
    blend: true,
    blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
    blendAlphaOperation: 'add', blendAlphaSrcFactor: 'src-alpha', blendAlphaDstFactor: 'one',
  } as any;
  const glow = (id: string, data: PathDatum[], width: number, alpha: number) =>
    new PathLayer<PathDatum>({
      id, data, getPath: (d: PathDatum) => d.pts, getColor: (d: PathDatum) => [...d.color, alpha],
      getWidth: width, widthUnits: 'pixels', jointRounded: true, capRounded: true, parameters: glowParams,
    } as any);
  // Contrail puffs: soft sprites sampled along the last ~30 s of each trail,
  // growing + fading with age, tinted by trace colour (normal alpha blend).
  const contrailOn = S.trailFx === 'contrail';
  const puffParams = {
    depthCompare: 'less-equal', depthWriteEnabled: false, blend: true,
    blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
    blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
  } as any;
  const puffs: { pos: Pos3; size: number; color: RGB; alpha: number }[] = [];
  if (contrailOn && !off) {
    const span = 30;
    for (const tr of vis) {
      const pr = presence(tr); if (!pr) continue;
      for (let age = 0; age <= span; age += 2) {
        const time = pr.time - age; if (time < tr.rstart) break;
        const p = posAt(tr, time);
        puffs.push({ pos: [p[0], p[1], markerZ(p, k, meshScale)], size: 12 + age * 1.5, color: tr.color, alpha: Math.round(75 * (1 - age / span)) });
      }
    }
  }
  // Ground shadows: a soft blob at each glider's ground point (straight down, or
  // offset along the sun ray), growing + fading with height, an altitude/light
  // line, and the track projected onto the terrain.
  const shAc: { pos: Pos3; heading: number; a: number; type: number }[] = [], stalks: { path: Pos3[]; c: RGB }[] = [], gtracks: PathDatum[] = [];
  if (S.shadowMode !== 'off') {
    const sun = getSun(), useSun = S.shadowMode === 'sun' && sun.up && Math.abs(sun.dir[2]) > 0.08, dir = sun.dir;
    for (const tr of vis) {
      if (S.mode === 'fpv' && tr.reg === S.subject) continue;
      const pr = presence(tr); if (!pr) continue;
      const p = posAt(tr, pr.time), gBelow = terrainElevAt(p[0], p[1]);
      if (gBelow == null) continue;
      const agl = Math.max(0, p[2] - gBelow), az = markerZ(p, k, meshScale);
      const sp = shadowGround(p[0], p[1], p[2], useSun, dir, k); if (!sp) continue;
      const sz = sp[2] + 1;
      // Glider-shaped silhouette laid flat on the ground, oriented to the heading.
      shAc.push({ pos: [sp[0], sp[1], sz], heading: headingAt(tr, pr.time), a: Math.round(Math.max(40, 165 - agl * 0.06)), type: tr.type });
      // Drop line only in nadir mode (a clear vertical altitude cue); in sun mode
      // the offset silhouette stands on its own — a slanted "ray" just confuses.
      if (!useSun) stalks.push({ path: [[p[0], p[1], az], [sp[0], sp[1], sz]], c: tr.color });
    }
  }
  // Track footprint on the terrain (always nadir — a sun-cast track smears into
  // noise in thermals). Shown with ground shadows OR the altitude curtain, since
  // it is the curtain's base line.
  if ((S.shadowMode !== 'off' || S.altCurtain) && !off) {
    for (const tr of vis) {
      if (S.mode === 'fpv' && tr.reg === S.subject) continue;
      const pr = presence(tr); if (!pr) continue;
      const t0 = histStart(tr), wp: number[][] = [];
      for (const rp of tr.rel) if (rp[3] >= t0 && rp[3] <= S.cur) wp.push(rp);
      const stride = Math.max(1, Math.floor(wp.length / 400)), pts: Pos3[] = [];   // decimate over the WINDOW so circles read
      for (let i = 0; i < wp.length; i += stride) { const rp = wp[i], gg = terrainElevAt(rp[0], rp[1]); if (gg != null) pts.push([rp[0], rp[1], gg * k + 1]); }
      if (pts.length >= 2) gtracks.push({ color: tr.color, pts });
    }
  }
  // Altitude curtains: one translucent vertical ribbon per glider (track → ground).
  const curtains: any[] = [];
  if (S.altCurtain && !off) {
    const cp = {
      depthCompare: 'less-equal', depthWriteEnabled: false, blend: true, cullMode: 'none',
      blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one-minus-src-alpha',
      blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
    } as any;
    for (const tr of vis) {
      if (S.mode === 'fpv' && tr.reg === S.subject) continue;
      const pr = presence(tr); if (!pr) continue;
      const t0 = histStart(tr), wp: number[][] = [];
      for (const rp of tr.rel) if (rp[3] >= t0 && rp[3] <= S.cur) wp.push(rp);
      if (wp.length < 2) continue;
      const stride = Math.max(1, Math.floor(wp.length / 300)), dp: number[][] = [];
      for (let i = 0; i < wp.length; i += stride) dp.push(wp[i]);
      if (dp[dp.length - 1] !== wp[wp.length - 1]) dp.push(wp[wp.length - 1]);
      const mesh = altCurtainMesh(dp, k); if (!mesh) continue;
      curtains.push(new SimpleMeshLayer({
        id: 'curtain-' + tr.reg, data: CURTAIN_ANCHOR, getPosition: () => [0, 0, 0], _instanced: false,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT, mesh, getColor: [...tr.color, 28], material: false, parameters: cp,
      } as any));
    }
  }
  return [
    ...nightBands.map((b, i) => new PolygonLayer({
      id: 'night-' + i, data: [b.poly], getPolygon: (d: any) => d, getFillColor: [4, 7, 22, b.a],
      stroked: false, parameters: { depthTest: false } as any,
    } as any)),
    ...(gtracks.length ? [
      new PathLayer<PathDatum>({ id: 'ground-track', data: gtracks, getPath: d => d.pts,
        getColor: d => [Math.round(d.color[0] * 0.35), Math.round(d.color[1] * 0.35), Math.round(d.color[2] * 0.35), 120],
        getWidth: 2, widthUnits: 'pixels', parameters: { depthTest: true } as any }),
    ] : []),
    ...(S.shadowMode !== 'off' ? [
      new PathLayer<{ path: Pos3[]; c: RGB }>({ id: 'shadow-stalk', data: stalks, getPath: d => d.path, getColor: d => [...d.c, 55],
        getWidth: 1, widthUnits: 'pixels', parameters: { depthTest: true } as any }),
      new SimpleMeshLayer({ id: 'shadow-gliders', data: shAc.filter(d => !isPowered(d.type)), mesh: GLIDER_FLAT as any,
        getPosition: (d: any) => d.pos, getOrientation: (d: any) => [0, 90 - d.heading, 0], getColor: (d: any) => [6, 8, 12, d.a],
        sizeScale: meshScale, material: false, parameters: shadowMeshParams }),
      new SimpleMeshLayer({ id: 'shadow-planes', data: shAc.filter(d => isPowered(d.type)), mesh: PLANE_FLAT as any,
        getPosition: (d: any) => d.pos, getOrientation: (d: any) => [0, 90 - d.heading, 0], getColor: (d: any) => [6, 8, 12, d.a],
        sizeScale: meshScale, material: false, parameters: shadowMeshParams }),
    ] : []),
    ...curtains,
    // Vapour glow under the trails — only for the neon + contrail effects (bloom
    // gets its glow from the post-process pass instead; basic gets none).
    ...(!off && (S.trailFx === 'glow' || S.trailFx === 'contrail') ? [
      glow('future-glow', futData, 9, 12), glow('future-glow2', futData, 4, 16),
      glow('past-glow', pastData, 11, 18), glow('past-glow2', pastData, 5, 30),
    ] : []),
    ...(puffs.length ? [new IconLayer({
      id: 'contrail', data: puffs,
      iconAtlas: smokeSprite(), iconMapping: { p: { x: 0, y: 0, width: 64, height: 64, mask: true } } as any,
      getIcon: () => 'p', getPosition: (d: any) => d.pos, getSize: (d: any) => d.size,
      getColor: (d: any) => [...d.color, d.alpha], sizeUnits: 'pixels', billboard: true, parameters: puffParams,
    } as any)] : []),
    new PathLayer<PathDatum>({ id: 'future', data: futData, getPath: d => d.pts, getColor: d => [...d.color, 55],
      getWidth: 2, widthUnits: 'pixels', jointRounded: true, capRounded: true, parameters: { depthTest: true } as any }),
    new PathLayer<PathDatum>({ id: 'future-gap', data: futGap, getPath: (d: PathDatum) => d.pts, getColor: (d: PathDatum) => [...d.color, 45],
      getWidth: 2, widthUnits: 'pixels', getDashArray: [5, 4], dashJustified: true, extensions: [dashExt], parameters: { depthTest: true } } as any),
    new PathLayer<PathDatum>({ id: 'past', data: pastData, getPath: d => d.pts, getColor: d => [...d.color, pastAlpha],
      getWidth: 2, widthUnits: 'pixels', jointRounded: true, capRounded: true, parameters: { depthTest: true } as any }),
    new PathLayer<PathDatum>({ id: 'past-gap', data: pastGap, getPath: (d: PathDatum) => d.pts, getColor: (d: PathDatum) => [...d.color, pastAlpha],
      getWidth: 2, widthUnits: 'pixels', getDashArray: [5, 4], dashJustified: true, extensions: [dashExt], parameters: { depthTest: true } } as any),
    new TripsLayer({ id: 'trips', data: off ? [] : vis, getPath: (tr: any) => scaled(tr), getTimestamps: (tr: any) => tr.rel.map((p: number[]) => p[3]), getColor: (tr: any) => tr.color,
      currentTime: S.cur, trailLength: trail, fadeTrail: true, widthMinPixels: 3, capRounded: true, jointRounded: true,
      parameters: { depthTest: true } as any, updateTriggers: { getPath: [S.exo] } }),
    new SimpleMeshLayer<AircraftDatum>({ id: 'gliders', data: gliders, mesh: GLIDER_MESH as any,
      getPosition: d => d.pos, getOrientation: d => d.orient, getColor: d => d.offline ? [...greyed(d.c, 0.6), 170] : [...d.c, 255],
      sizeScale: meshScale, material: aircraftMaterial as any, parameters: { depthTest: true } as any }),
    new SimpleMeshLayer<AircraftDatum>({ id: 'planes', data: planes, mesh: PLANE_MESH as any,
      getPosition: d => d.pos, getOrientation: d => d.orient, getColor: d => d.offline ? [...greyed(d.c, 0.6), 170] : [...d.c, 255],
      sizeScale: meshScale, material: aircraftMaterial as any, parameters: { depthTest: true } as any }),
    // Spinning propeller: the plane mesh oriented + an extra roll about the nose,
    // advanced each frame (render runs every frame, so it spins even when paused).
    new SimpleMeshLayer<AircraftDatum>({ id: 'props', data: planes, mesh: PROP_MESH as any,
      getPosition: d => d.pos, getOrientation: d => [d.orient[0], d.orient[1], d.orient[2] + propSpin], getColor: [28, 30, 34, 255],
      sizeScale: meshScale, material: aircraftMaterial as any, parameters: { depthTest: true } as any, updateTriggers: { getOrientation: propSpin } }),
    new ScatterplotLayer({ id: 'airfield', data: S.AF && S.source !== 'file' ? [{ pos: [S.AF.lon, S.AF.lat, S.AF.elev * k] as Pos3 }] : [], getPosition: (d: any) => d.pos,
      getFillColor: [255, 60, 60], getRadius: 6, radiusUnits: 'pixels', stroked: true, lineWidthMinPixels: 1.5, getLineColor: [255, 255, 255] }),
    ...((() => {
      const fp = focusTr ? presence(focusTr) : null;
      if (!focusTr || !fp) return [];
      // Dashed halo around the focus glider. A pixel-radius circle isn't possible
      // with PathLayer, so build a geographic ring whose radius tracks the zoom's
      // metres-per-pixel — keeping it ~constant on screen.
      const p = posAt(focusTr, fp.time), z = groundClamp(p) * k, lat = p[1] * Math.PI / 180;
      const R = 18 * 156543.03392 * Math.cos(lat) / Math.pow(2, S.mapVS.zoom);
      const mPerLng = 111320 * Math.cos(lat), mPerLat = 111320;
      const ring: Pos3[] = [];
      for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI; ring.push([p[0] + R * Math.cos(a) / mPerLng, p[1] + R * Math.sin(a) / mPerLat, z]); }
      return [new PathLayer({
        id: 'focus-ring', data: [ring], getPath: (d: any) => d, getColor: [...focusTr!.color, 150] as any,
        getWidth: 2, widthUnits: 'pixels', getDashArray: [5, 4], dashJustified: true, extensions: [dashExt],
        parameters: { depthTest: false } as any,
      } as any)];
    })()),
    ...(S.glideCone ? glideConeLayers(k) : []),
    ...(S.thermalPot ? (() => {
      // Blend from the mixer: each component's opacity scales with its weight (gamma
      // lifts the mid-blend so a 50/50 is still legible). Skip a near-zero component.
      const g = (key: string): number => { const w = liftWeight(key); return w > 0.02 ? Math.pow(w, 0.55) : 0; };
      const at = g('thermal'), as = g('slope'), ac = g('converg'), aw = g('wave');
      return [...(at ? thermalLayers(k, at) : []), ...(as ? ridgeLayers(k, as) : []),
        ...(ac ? convergLayers(k, ac) : []), ...(aw ? waveLayers(k, aw) : [])];
    })() : []),
    ...(S.airMass ? [...airMassLayers(k), ...waveMassLayers(k)] : []),
    ...(S.windMode !== 'off' ? windLayers(k) : []),
    ...poiPoleLayers(k),
    ...(S.cols ? colLayers(k) : []),
  ];
}

// SVG for the moon's lit phase. viewBox is centred at the origin (R=50). The lit
// region is drawn for a waxing moon (limb on the right): the right outer limb
// plus the terminator, a half-ellipse whose width shrinks to a line at quarter
// (fraction 0.5) and bulges to the far limb at full. Waning mirrors it (lit on
// the left). A faint full disc hints the orb (earthshine) for thin crescents.
function moonSvg(fraction: number, waxing: boolean, disc: [number, number, number]): string {
  const R = 50, rx = R * (1 - 2 * fraction), sweep = rx > 0 ? 0 : 1;       // crescent vs gibbous curvature
  const lit = `M0 ${-R} A${R} ${R} 0 0 1 0 ${R} A${Math.abs(rx).toFixed(2)} ${R} 0 0 ${sweep} 0 ${-R} Z`;
  const c = disc.join(',');
  const g = waxing ? '' : ' transform="scale(-1 1)"';
  return `<svg viewBox="-50 -50 100 100"><circle r="49" fill="rgba(150,162,205,0.10)"/>`
    + `<g${g}><path d="${lit}" fill="rgb(${c})"/></g></svg>`;
}

// Position the sun + moon discs (small fixed elements) at their projected screen
// positions. Updating tiny elements is cheap (unlike repainting the full-viewport
// sky bg, which janked pan/zoom). Hidden when behind the camera or off-screen.
let sunShown = false, moonShown = false, moonKey = '';
// ---- per-aircraft labels as a DOM overlay ----
// deck's TextLayer doesn't render under FirstPersonView, so labels are plain
// <div>s positioned by projecting each aircraft's world position to screen —
// the same approach the sun/moon use, which works in every view.
const labelEls: HTMLElement[] = [];
function projectToScreen(vp: any, lon: number, lat: number, alt: number, w: number, h: number): [number, number] | null {
  const cp = vp.projectPosition([lon, lat, alt]), m = vp.viewProjectionMatrix;
  const cx = cp[0], cy = cp[1], cz = cp[2];
  const cw = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
  if (cw <= 1e-6) return null;                                        // behind the camera
  const nx = (m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / cw, ny = (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / cw;
  if (nx < -1.3 || nx > 1.3 || ny < -1.3 || ny > 1.3) return null;   // off-screen
  return [(nx * 0.5 + 0.5) * w, (0.5 - ny * 0.5) * h];
}
function labelText(tr: RenderTrack, time: number): string {
  const lf = S.labelFields, p = posAt(tr, time), parts: string[] = [];
  if (lf.alt) parts.push(fmtAlt(p));
  if (lf.speed) parts.push(Math.round(groundSpeedAt(tr, time) * 3.6) + ' km/h');
  if (lf.vario) { const v = S.compensated ? compVarioAt(tr, time) : varioAt(tr, time); parts.push((v >= 0 ? '+' : '') + v.toFixed(1) + ' m/s'); }
  if (lf.hdg) parts.push(Math.round(headingAt(tr, time)).toString().padStart(3, '0') + '°');
  return [lf.reg ? displayReg(tr) : '', parts.join('  ')].filter(Boolean).join('\n');
}
function updateLabels(): void {
  const lf = S.labelFields, on = S.ready && S.labels && (lf.reg || lf.alt || lf.speed || lf.vario || lf.hdg);
  const width = mapDiv.clientWidth, height = mapDiv.clientHeight;
  let vp: any = null;
  if (on && width && height) {
    try {
      vp = S.mode === 'over'
        ? new MapView({ id: 'main' }).makeViewport({ width, height, viewState: S.mapVS as any })
        : new FirstPersonView({ id: 'fpv', fovy: S.mode === 'chase' ? CHASE.fovy : 64, near: 1, far: farPlane() })
          .makeViewport({ width, height, viewState: (S.mode === 'chase' ? computeChase() : computeFPV()) as any });
    } catch { vp = null; }
  }
  let n = 0;
  if (vp && vp.viewProjectionMatrix) try {
    const k = S.exo, meshScale = S.modelScale[S.mode];
    for (const tr of S.TRACKS) {
      // Skip the followed glider in cockpit/chase — its data is already in the HUD.
      if (!shown(tr) || ((S.mode === 'fpv' || S.mode === 'chase') && tr.reg === S.subject)) continue;
      const pr = presence(tr); if (!pr) continue;
      const p = posAt(tr, pr.time);
      const sp = projectToScreen(vp, p[0], p[1], markerZ(p, k, meshScale), width, height);
      if (!sp) continue;
      const text = labelText(tr, pr.time); if (!text) continue;
      let el = labelEls[n];
      if (!el) { el = document.createElement('div'); el.className = 'aclabel'; labelsDiv.appendChild(el); labelEls[n] = el; }
      el.style.display = 'block'; el.style.left = sp[0].toFixed(0) + 'px'; el.style.top = (sp[1] - 16).toFixed(0) + 'px';
      el.style.color = `rgb(${tr.color.join(',')})`;
      if (el.textContent !== text) el.textContent = text;
      n++;
    }
  } catch { /* projection unavailable this frame — hide everything below */ }
  for (let i = n; i < labelEls.length; i++) labelEls[i].style.display = 'none';
}

// ---- POI (summit / waypoint) labels, DOM overlay above each pole ----
const poiEls: HTMLElement[] = [];
function updatePeakLabels(): void {
  const on = S.ready && S.showPeaks;
  const width = mapDiv.clientWidth, height = mapDiv.clientHeight;
  let vp: any = null;
  if (on && width && height) {
    try {
      vp = S.mode === 'over'
        ? new MapView({ id: 'main' }).makeViewport({ width, height, viewState: S.mapVS as any })
        : new FirstPersonView({ id: 'fpv', fovy: S.mode === 'chase' ? CHASE.fovy : 64, near: 1, far: farPlane() })
          .makeViewport({ width, height, viewState: (S.mode === 'chase' ? computeChase() : computeFPV()) as any });
    } catch { vp = null; }
  }
  let n = 0;
  if (vp && vp.viewProjectionMatrix) try {
    const k = S.exo, placed: [number, number][] = [], pois = activePois();   // peaks are highest-first → get priority
    // Font size scales with a summit's importance (its elevation relative to the
    // shown set), so major peaks stand out over minor ones.
    const eles = pois.filter(p => p.kind === 'peak').map(p => p.ele);
    const minE = eles.length ? Math.min(...eles) : 0, span = Math.max(1, (eles.length ? Math.max(...eles) : 1) - minE);
    for (const p of pois) {
      const sp = projectToScreen(vp, p.lon, p.lat, (p.ele + POLE_M) * k, width, height);
      if (!sp) continue;
      const imp = p.kind === 'peak' ? (p.ele - minE) / span : 0.5;     // 0 (minor) .. 1 (highest)
      const fs = 9 + imp * 6;                                          // 9..15 px
      if (placed.some(q => Math.abs(q[0] - sp[0]) < 46 && Math.abs(q[1] - sp[1]) < fs + 2)) continue;   // de-clutter
      placed.push(sp);
      let el = poiEls[n];
      if (!el) {
        el = document.createElement('div'); el.className = 'poilabel';
        (el.appendChild(document.createElement('span')) as HTMLElement).className = 'gly';   // colored type glyph
        el.appendChild(document.createTextNode(''));                                         // name + elevation
        poiLabelsDiv.appendChild(el); poiEls[n] = el;
      }
      el.style.display = 'block'; el.style.left = sp[0].toFixed(0) + 'px'; el.style.top = (sp[1] - 4).toFixed(0) + 'px';
      el.style.fontSize = fs.toFixed(1) + 'px'; el.style.opacity = (0.62 + imp * 0.38).toFixed(2);
      el.classList.toggle('wp', p.kind === 'wp');
      const st = poiStyle(p), gly = el.firstChild as HTMLElement, txt = el.lastChild as Text;
      if (gly.textContent !== st.glyph) gly.textContent = st.glyph;
      gly.style.color = `rgb(${st.color[0]},${st.color[1]},${st.color[2]})`;
      const text = ` ${p.name}\n${Math.round(p.ele)} m`;
      if (txt.nodeValue !== text) txt.nodeValue = text;
      n++;
    }
  } catch { /* projection unavailable this frame */ }
  for (let i = n; i < poiEls.length; i++) poiEls[i].style.display = 'none';
}

function updateCelestial(): void {
  const sun = getSun(), moon = getMoon();
  const hideSun = () => { if (sunShown) { sunEl.style.display = 'none'; sunShown = false; } };
  const hideMoon = () => { if (moonShown) { moonEl.style.display = 'none'; moonShown = false; } };
  if (!sun.up) hideSun();
  if (!moon.up) hideMoon();
  if (!sun.up && !moon.up) return;
  const width = mapDiv.clientWidth, height = mapDiv.clientHeight;
  if (!width || !height) { hideSun(); hideMoon(); return; }
  // Build the viewport from the current view state (not deckgl.getViewports(),
  // which interfered with the pan/zoom controller).
  let vp: any;
  try {
    vp = (S.mode === 'fpv' || S.mode === 'chase')
      ? new FirstPersonView({ id: 'fpv', fovy: CHASE.fovy, near: 1, far: farPlane() }).makeViewport({ width, height, viewState: (S.mode === 'chase' ? computeChase() : computeFPV()) as any })
      : new MapView({ id: 'main' }).makeViewport({ width, height, viewState: S.mapVS as any });
  } catch (e) { hideSun(); hideMoon(); return; }
  if (!vp || !vp.viewProjectionMatrix) { hideSun(); hideMoon(); return; }
  // Eye-level views: the sun/moon disc is an HTML overlay, so it can't be
  // depth-occluded by the 3D terrain. Ray-march the terrain along the body's
  // azimuth from the glider to find the skyline ridge, then CLIP the disc at that
  // ridge (clip-path) — a body behind a mountain is partly, or fully, hidden.
  let eye: { lon: number; lat: number; alt: number } | null = null;
  if (S.mode === 'fpv' || S.mode === 'chase') {
    const tr = subjectTrack();
    if (tr) { const ep = posAt(tr, clampCur(tr)); eye = { lon: ep[0], lat: ep[1], alt: groundClamp(ep) }; }
  }
  const u = (vp.distanceScales && vp.distanceScales.unitsPerMeter) || [1, 1, 1];
  const m = vp.viewProjectionMatrix;                                       // column-major
  // Project a direction at infinity (w = 0) to screen px; null if behind/off-screen.
  const project = (toward: [number, number, number]): [number, number] | null => {
    const dx = toward[0] * u[0], dy = toward[1] * u[1], dz = toward[2] * u[2];
    const cw = m[3] * dx + m[7] * dy + m[11] * dz;
    if (cw <= 1e-6) return null;
    const nx = (m[0] * dx + m[4] * dy + m[8] * dz) / cw, ny = (m[1] * dx + m[5] * dy + m[9] * dz) / cw;
    if (Math.abs(nx) > 1.4 || Math.abs(ny) > 1.4) return null;
    return [(nx * 0.5 + 0.5) * vp.width, (0.5 - ny * 0.5) * vp.height];
  };
  // Steepest terrain elevation-angle (tan, exo-scaled to match the render) along
  // a horizontal azimuth from the eye — the skyline ridge in that direction.
  const ridgeTan = (dirE: number, dirN: number, mLng: number): number => {
    let maxTan = -Infinity;
    for (let s = 150; s <= 16000; s += Math.max(70, s * 0.08)) {
      const terr = terrainElevAt(eye!.lon + s * dirE / mLng, eye!.lat + s * dirN / 111320);
      if (terr != null) { const tan = (terr - eye!.alt) * S.exo / s; if (tan > maxTan) maxTan = tan; }
    }
    return maxTan;
  };
  // Clip-path that cuts the disc (centre px,py, radius r) along the terrain
  // skyline, so a body behind a mountain is hidden below the real ridge profile
  // (not a flat line). '' = clear, null = fully hidden, else a polygon(...).
  const clipDisc = (toward: [number, number, number], px: number, py: number, r: number): string | null => {
    if (!eye) return '';
    const horiz = Math.hypot(toward[0], toward[1]); if (horiz < 1e-3) return '';
    const azE = toward[0] / horiz, azN = toward[1] / horiz, mLng = 111320 * Math.cos(eye.lat * Math.PI / 180);
    // Sample the ridge across a spread of azimuths spanning the disc's width.
    const pts: [number, number][] = [];                                    // local (x,y) on the disc box, left→right
    for (let i = -6; i <= 6; i++) {
      const d = i * 0.012, cd = Math.cos(d), sd = Math.sin(d);             // rotate the azimuth by d rad
      const e = azE * cd - azN * sd, n = azE * sd + azN * cd;
      const tan = ridgeTan(e, n, mLng); if (!(tan > -Infinity)) continue;
      const inv = 1 / Math.sqrt(1 + tan * tan);
      const rp = project([e * inv, n * inv, tan * inv]); if (!rp) continue;
      if (rp[0] < px - r - 4 || rp[0] > px + r + 4) continue;              // outside the disc horizontally
      pts.push([Math.max(0, Math.min(2 * r, rp[0] - (px - r))), Math.max(0, Math.min(2 * r, rp[1] - (py - r)))]);
    }
    if (pts.length < 2) return '';                                         // no ridge across the disc → clear
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.every(p => p[1] <= 0)) return null;                            // skyline above the whole disc → hidden
    if (pts.every(p => p[1] >= 2 * r)) return '';                          // skyline below the disc → clear
    // Keep everything ABOVE the skyline: top edge + the ridge profile back to the left.
    const D = 2 * r, seg = pts.map(p => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`);
    const right = `${D}px ${pts[pts.length - 1][1].toFixed(1)}px`, left = `0px ${pts[0][1].toFixed(1)}px`;
    return `polygon(0px 0px, ${D}px 0px, ${right}, ${seg.slice().reverse().join(', ')}, ${left})`;
  };
  if (sun.up) {
    const p = project(sun.toward);
    const clip = p ? clipDisc(sun.toward, p[0], p[1], (sunEl.offsetWidth || 104) / 2) : null;
    if (!p || clip === null) hideSun();
    else {
      const c = sun.disc.join(',');
      sunEl.style.left = p[0].toFixed(0) + 'px'; sunEl.style.top = p[1].toFixed(0) + 'px';
      sunEl.style.background = `radial-gradient(circle, rgb(${c}) 0%, rgb(${c}) 17%, rgba(${c},0.5) 32%, rgba(${c},0) 64%)`;
      sunEl.style.clipPath = clip; sunEl.style.display = 'block'; sunShown = true;
    }
  }
  if (moon.up && moon.fraction > 0.04) {                                   // hide a ~new (invisible) moon
    const p = project(moon.toward);
    const clip = p ? clipDisc(moon.toward, p[0], p[1], (moonEl.offsetWidth || 48) / 2) : null;
    if (!p || clip === null) hideMoon();
    else {
      const key = Math.round(moon.fraction * 100) + (moon.waxing ? 'w' : 'n') + moon.disc.join(',');
      if (key !== moonKey) { moonEl.innerHTML = moonSvg(moon.fraction, moon.waxing, moon.disc); moonKey = key; }
      moonEl.style.left = p[0].toFixed(0) + 'px'; moonEl.style.top = p[1].toFixed(0) + 'px';
      moonEl.style.clipPath = clip; moonEl.style.display = 'block'; moonShown = true;
    }
  } else hideMoon();
}

// deck's FirstPersonViewport forward vector for a given bearing/pitch (matches
// its SphericalCoordinates math: F = [cos(vp)·sin(b), cos(vp)·cos(b), -sin(vp)]).
function forwardVec(bearingDeg: number, pitchDeg: number): Pos3 {
  const b = bearingDeg * Math.PI / 180, vp = pitchDeg * Math.PI / 180, cvp = Math.cos(vp);
  return [cvp * Math.sin(b), cvp * Math.cos(b), -Math.sin(vp)];
}

// World-up [0,0,1] rolled around the look axis F by `phi` (Rodrigues). Feeding
// this as the FirstPersonView `up` banks the horizon. phi>0 = right bank.
function rollUp(F: Pos3, phi: number): Pos3 {
  const c = Math.cos(phi), s = Math.sin(phi), f = (1 - c) * F[2]; // F[2] = F·worldUp
  return [F[1] * s + F[0] * f, -F[0] * s + F[1] * f, c + F[2] * f];
}

// First-person view state pinned to the subject glider. In follow mode the
// horizon banks with the estimated roll; free look stays level.
function computeFPV() {
  // Free observer (teleport): anchored at a fixed point/altitude, free look.
  if (S.obs) return { longitude: S.obs.lon, latitude: S.obs.lat, position: [0, 0, S.obs.alt * S.exo], bearing: S.obs.bearing, pitch: S.obs.pitch };
  const tr = subjectTrack(), time = clampCur(tr), p = posAt(tr, time);
  const base = { longitude: p[0], latitude: p[1], position: [0, 0, groundClamp(p) * S.exo + 3] };
  if (!S.fpvFollow) return { ...base, bearing: S.freeCam.bearing, pitch: S.freeCam.pitch };
  const bearing = headingAt(tr, time), pitch = S.fpvPitch;
  if (!S.bank) return { ...base, bearing, pitch }; // level horizon
  const roll = attitudeAt(tr, time).roll;
  return { ...base, bearing, pitch, up: rollUp(forwardVec(bearing, pitch), roll) };
}

// Chase cam: a FirstPersonView orbiting the aircraft, always looking AT it. The
// viewpoint is spherical relative to the aircraft (S.chase): az orbits around it
// (0 = directly behind), el is the elevation above it, dist is the slant range.
// The camera is anchored at the aircraft's lng/lat with a metric offset, so the
// framing is independent of altitude / terrain / vertical exaggeration, and the
// aircraft stays centred at any az/el/dist (look bearing/pitch point back at it).
function computeChase() {
  const tr = subjectTrack(), time = clampCur(tr), p = posAt(tr, time);
  const heading = headingAt(tr, time), z = groundClamp(p) * S.exo;  // aircraft height (clamped to terrain)
  const { az, el, dist } = S.chase;
  const camBearing = (heading + 180 + az) * Math.PI / 180;         // direction aircraft → camera
  const elR = el * Math.PI / 180, horiz = dist * Math.cos(elR), vert = dist * Math.sin(elR);
  return {
    longitude: p[0], latitude: p[1],
    position: [horiz * Math.sin(camBearing), horiz * Math.cos(camBearing), z + vert],
    bearing: heading + az,                                         // look back toward the aircraft
    pitch: el,                                                     // look down by the elevation angle
  };
}

let deckgl: Deck;

// ---- image export (PNG / WebP) ----
// deck renders to a WebGL canvas whose buffer isn't preserved, so we grab it inside
// onAfterRender — right after the draw, when the pixels are still valid. The DOM overlays
// (labels, HUD, minimap) live outside the canvas and are not captured.
let pendingCapture: 'png' | 'webp' | null = null;
function doCapture(fmt: 'png' | 'webp'): void {
  const canvas: HTMLCanvasElement | null = (deckgl as any).getCanvas?.() ?? mapDiv.querySelector('canvas');
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
    a.href = url; a.download = `ogn-3d-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${fmt}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 8000);
  }, fmt === 'webp' ? 'image/webp' : 'image/png', fmt === 'webp' ? 0.92 : undefined);
}
/** Download the current 3D scene as a PNG or WebP (captured on the next rendered frame). */
export function exportImage(fmt: 'png' | 'webp'): void {
  pendingCapture = fmt;
  deckgl.redraw('capture');   // force a fresh frame so onAfterRender fires with valid pixels
}

// Create the terrain layer and the deck.gl instance. Called once from main.ts.
export function initDeck(): void {
  S.terrainInst = makeTerrain();
  deckgl = new Deck({
    parent: mapDiv,
    views: [new MapView({ id: 'main' })], viewState: { main: S.mapVS }, controller: { keyboard: false }, effects: [lighting],
    onAfterRender: () => { if (pendingCapture) { const f = pendingCapture; pendingCapture = null; doCapture(f); } },
    onViewStateChange: ({ viewState, interactionState }: any) => {
      if (S.mode === 'over') {
        S.mapVS = viewState; const it = interactionState || {};
        if (it.isDragging || it.isPanning || it.isRotating || it.isZooming) { S.mapTarget = { ...viewState }; S.focusLock = null; }   // panning resumes nearest-to-centre focus
      } else if (S.mode === 'fpv' && S.obs) {
        S.obs.bearing = viewState.bearing; S.obs.pitch = viewState.pitch;   // free look from the teleport point
        const pos = viewState.position;                                     // fold any translation into the anchor
        if (pos && (pos[0] || pos[1] || pos[2])) {
          const mLng = 111320 * Math.cos(S.obs.lat * Math.PI / 180) || 1;
          S.obs.lon += pos[0] / mLng; S.obs.lat += pos[1] / 111320; S.obs.alt = Math.max(0, S.obs.alt + pos[2] / S.exo);
        }
      } else if (S.mode === 'fpv' && !S.fpvFollow) { S.freeCam = { bearing: viewState.bearing, pitch: viewState.pitch }; }
    },
    layers: [S.terrainInst, ...dynamicLayers()],
  } as any);
}

export function render(): void {
  saveSettings(S);    // debounced + dirty-checked: persists settings when they change
  updateSky();        // recompute sky colours + sun (before building the layers)
  applySunLight();
  // Scene-wide bloom only in the "bloom" effect (else just the scene lighting).
  const bloom = S.trailFx === 'bloom' ? getBloom() : null;
  const effects = bloom ? [lighting, bloom] : [lighting];
  if (S.mode === 'over') {
    // The glider nearest the scene centre (the one cockpit/chase will adopt).
    // Recomputed each frame so it tracks the camera and time.
    // Manual pick (J/K, HUD ◀/▶) pins the focus; otherwise it's the glider
    // nearest the scene centre.
    if (S.focusLock && S.TRACKS.some(tr => tr.reg === S.focusLock)) S.focus = S.focusLock;
    else { S.focusLock = null; const f = nearestToCenter(); S.focus = f ? f.reg : null; }
    deckgl.setProps({
      views: [new MapView({ id: 'main' })], viewState: { main: S.mapVS }, controller: { keyboard: false }, effects,
      layers: [S.terrainInst, ...dynamicLayers()],
    } as any);
    if (S.overviewHud) updateHUD();
  } else if (S.mode === 'chase') {
    deckgl.setProps({
      views: [new FirstPersonView({ id: 'fpv', fovy: CHASE.fovy, near: 1, far: farPlane() })], viewState: { fpv: computeChase() }, effects,
      controller: false, layers: [S.terrainInst, ...dynamicLayers()],
    } as any);
    updateHUD();
  } else {
    deckgl.setProps({
      views: [new FirstPersonView({ id: 'fpv', fovy: 64, near: 1, far: farPlane() })], viewState: { fpv: computeFPV() }, effects,
      controller: S.fpvFollow ? false : { keyboard: false, scrollZoom: false, inertia: 200 }, layers: [S.terrainInst, ...dynamicLayers()],
    } as any);
    updateHUD();
  }
  updateFocusUI();
  updateLegendLocal();
  feedVarioSound();
  updateCelestial();
  updatePeakFetch();
  updateLabels();
  updatePeakLabels();
  updateMinimap();
  drawGraphs();
  drawTraffic();
}

// Reflect the overview focus candidate in the legend: a badge (registration +
// trace colour) under the title, and an outline on the matching glider row. All
// cleared in cockpit/chase, where the followed glider is shown by the HUD instead.
function updateFocusUI(): void {
  const over = S.mode === 'over';
  const rows = lglist.children;
  for (let i = 0; i < rows.length; i++) {
    (rows[i] as HTMLElement).classList.toggle('focus', over && !!S.TRACKS[i] && S.TRACKS[i].reg === S.focus);
  }
  const tr = over && S.focus ? S.TRACKS.find(t2 => t2.reg === S.focus) : null;
  if (tr) {
    focusBadge.style.display = 'flex';
    focusBadge.innerHTML = `<span class="lbl2">${t('focusLabel')}</span>` +
      `<span class="dot" style="background:rgb(${tr.color.join(',')})"></span>` +
      `<span class="reg">${displayReg(tr)}</span><span class="mut">${tr.label}</span>`;
  } else {
    focusBadge.style.display = 'none'; focusBadge.innerHTML = '';
  }
}

// Per-frame "local" badge in the legend: when the glide cone is on, mark each
// glider that can currently reach the airfield (sits above the glide floor).
function updateLegendLocal(): void {
  const rows = lglist.children;
  for (let i = 0; i < rows.length; i++) {
    const tr = S.TRACKS[i];
    (rows[i] as HTMLElement).classList.toggle('inactive', S.activeOnly && !!tr && !isActive(tr));   // "active only" filter
    const loc = (rows[i] as HTMLElement).querySelector('.loc') as HTMLElement | null;
    if (!loc) continue;
    if (!S.glideCone || !tr || !airborne(tr, S.cur)) { loc.className = 'loc'; loc.textContent = ''; loc.title = ''; continue; }
    const ok = reachable(tr);
    loc.className = 'loc ' + (ok ? 'ok' : 'no'); loc.textContent = '🏠'; loc.title = ok ? t('reachOk') : t('reachNo');
  }
}

// Drive the audio variometer from the followed glider's Vz (cockpit & chase only,
// when present & live/online and sound is on). Uses the same compensated/raw
// setting as the HUD. A stale (offline) live fix is muted — its Vz is meaningless.
// Also muted when replay is paused: the scene is frozen, so the Vz is stale
// (the scene only advances in live mode or while playing).
function feedVarioSound(): void {
  const following = S.mode === 'fpv' || S.mode === 'chase';
  const tr = following && S.ready ? subjectTrack() : undefined;
  const pr = tr ? presence(tr) : null;
  const active = !!(S.sound && (S.live || S.playing) && pr && !pr.offline);
  const vz = active ? (S.compensated ? compVarioAt(tr!, pr!.time) : varioAt(tr!, pr!.time)) : 0;
  varioAudio.update(vz, active);
}

// Aircraft altitude in the aviation "altitude (height)" style: the AMSL altitude
// is primary, a height above a datum is the parenthetical. Datum = the departure
// aerodrome's published elevation (a solid value, QFE analogue) or — for the
// ground option — the DEM directly below (AGL). p[2] is already orthometric
// (buildRel removed the geoid offset), consistent with both S.AF.elev and the DEM.
function fmtAlt(p: Pos3): string {
  const main = Math.round(p[2]) + ' m';
  if (S.heightRef === 'off') return main;
  if (S.heightRef === 'ground') {
    const g = terrainElevAt(p[0], p[1]);
    return g != null ? `${main} · ⛰ ${Math.round(p[2] - g)} m` : main;
  }
  const af = S.AF;   // 'af': height above the departure aerodrome (published elevation)
  if (!af) return main;
  const h = Math.round(p[2] - af.elev);
  return `${main} (${h >= 0 ? '+' : ''}${h} m)`;
}

// ---- HUD ----
const varioCls = (x: number): string => 'vario ' + (x >= 0.1 ? 'pos' : (x <= -0.1 ? 'neg' : ''));
const fmtVario = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1) + ' m/s';
// A meteorological wind barb (SVG, currentColor): staff toward where the wind comes FROM
// (up = north), barbs on the left — half = 5 kt, full = 10 kt, pennant = 50 kt (rounded to
// 5 kt); calm (< 1 kt) = a small circle. `az` is the FROM azimuth in degrees.
function windBarbSvg(kt: number, az: number, size = 36): string {
  const cx = size / 2, cy = size / 2, sw = 'stroke="currentColor" stroke-width="1.5"';
  if (kt < 1) return `<circle cx="${cx}" cy="${cy}" r="4" fill="none" ${sw}/>`;
  const a = az * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), L = size * 0.42;
  const tx = cx + dx * L, ty = cy + dy * L, px = -dy, py = dx;   // tip = FROM end; px,py = barb side (left)
  const bl = size * 0.30, slot = L * 0.2, lean = 0.35, f = (n: number) => n.toFixed(1);
  const P = (d: number): [number, number] => [tx - dx * d, ty - dy * d];   // point on staff, d from tip toward centre
  const B = (b: [number, number], s: number): [number, number] => [b[0] + px * bl * s + dx * bl * lean * s, b[1] + py * bl * s + dy * bl * lean * s];
  let five = Math.round(kt / 5) * 5; const pen = Math.floor(five / 50); five -= pen * 50;
  const full = Math.floor(five / 10); five -= full * 10; const half = Math.floor(five / 5);
  let e = `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(tx)}" y2="${f(ty)}" ${sw}/>`, d = 0;
  for (let i = 0; i < pen; i++) { const b0 = P(d), b1 = P(d + slot), ap = B(b0, 1); e += `<polygon points="${f(b0[0])},${f(b0[1])} ${f(ap[0])},${f(ap[1])} ${f(b1[0])},${f(b1[1])}" fill="currentColor" stroke="none"/>`; d += slot; }
  if (pen) d += slot * 0.4;
  for (let i = 0; i < full; i++) { const b0 = P(d), be = B(b0, 1); e += `<line x1="${f(b0[0])}" y1="${f(b0[1])}" x2="${f(be[0])}" y2="${f(be[1])}" ${sw}/>`; d += slot; }
  if (half) { const b0 = P(pen + full ? d : slot), be = B(b0, 0.5); e += `<line x1="${f(b0[0])}" y1="${f(b0[1])}" x2="${f(be[0])}" y2="${f(be[1])}" ${sw}/>`; }
  return e;
}
// Set the HUD wind barb + text from the wind at the glider's position/altitude (or '—').
function setHudWind(p: Pos3 | null): void {
  const w = p ? windAtAlt(p[1], p[0], p[2]) : null;
  if (!w) { hudwindbarb.innerHTML = ''; hudwindtxt.textContent = '—'; return; }
  const spd = Math.hypot(w[0], w[1]), az = (Math.atan2(-w[0], -w[1]) * 180 / Math.PI + 360) % 360;
  hudwindbarb.innerHTML = windBarbSvg(spd * 1.94384, az);
  hudwindtxt.textContent = Math.round(az).toString().padStart(3, '0') + '° · ' + Math.round(spd * 3.6) + ' km/h';
}
export function updateHUD(): void {
  // Netto / super-netto rows are opt-in (S.nettoMode) — show/hide their grid cells.
  const nm = S.nettoMode;
  hudnettoK.style.display = hudnetto.style.display = nm !== 'off' ? '' : 'none';
  hudsuperK.style.display = hudsuper.style.display = nm === 'super' ? '' : 'none';
  if (S.obs) {   // free observer (teleport): show its position/heading/AGL + the wind there
    hudreg.textContent = '🛰 ' + t('observer');
    hudhdg.textContent = Math.round(((S.obs.bearing % 360) + 360) % 360).toString().padStart(3, '0') + '°';
    const g = terrainElevAt(S.obs.lon, S.obs.lat);
    hudalt.textContent = Math.round(S.obs.alt) + ' m' + (g != null ? ` (${S.obs.alt - g >= 0 ? '+' : ''}${Math.round(S.obs.alt - g)} m ${t('agl')})` : '');
    hudspd.textContent = '—'; hudvar.textContent = '—'; hudvar.className = 'vario';
    hudnetto.textContent = '—'; hudnetto.className = 'vario'; hudsuper.textContent = '—'; hudsuper.className = 'vario';
    setHudWind([S.obs.lon, S.obs.lat, S.obs.alt]); return;
  }
  if (!S.ready) return;
  // In the overview the HUD (opt-in) reads the focused glider; elsewhere the subject.
  const tr = (S.mode === 'over' && S.focus ? S.TRACKS.find(t2 => t2.reg === S.focus) : null) || subjectTrack();
  const pr = presence(tr);
  hudreg.textContent = displayReg(tr) + ' · ' + tr.label + (pr && pr.offline ? ' · ' + t('offline') : '');
  if (!pr) {
    hudhdg.textContent = '—'; hudspd.textContent = '—'; hudalt.textContent = '—'; setHudWind(null);
    hudnetto.textContent = '—'; hudnetto.className = 'vario'; hudsuper.textContent = '—'; hudsuper.className = 'vario';
    hudvar.textContent = S.cur < tr.rstart ? t('beforeTk') : t('landed'); hudvar.className = 'vario'; return;
  }
  const time = pr.time;
  const p = posAt(tr, time), h = headingAt(tr, time), v = S.compensated ? compVarioAt(tr, time) : varioAt(tr, time);
  hudhdg.textContent = Math.round(h).toString().padStart(3, '0') + '°'; hudalt.textContent = fmtAlt(p); setHudWind(p);
  hudspd.textContent = Math.round(groundSpeedAt(tr, time) * 3.6) + ' km/h';
  hudvar.textContent = fmtVario(v) + (S.compensated ? ' TE' : ''); hudvar.className = varioCls(v);
  if (nm !== 'off') {
    // Netto = total-energy vario − the glider's own sink at this (ground-)speed. Super
    // netto also removes the circling (min-)sink: the climb achievable by thermalling here.
    const te = compVarioAt(tr, time), spd = groundSpeedAt(tr, time);
    const nz = nettoAt(S.polar, te, spd);
    hudnetto.textContent = fmtVario(nz); hudnetto.className = varioCls(nz);
    if (nm === 'super') { const sz = nz + minSink(S.polar); hudsuper.textContent = fmtVario(sz); hudsuper.className = varioCls(sz); }
  }
}
