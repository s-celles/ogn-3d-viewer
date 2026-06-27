// ============ viewer: deck.gl instance, dynamic layers, HUD ============
import { S } from './state';
import { t } from './i18n';
import { mapDiv, sunEl, moonEl, hudreg, hudhdg, hudalt, hudvar } from './dom';
import {
  Deck, MapView, FirstPersonView, PathLayer, TripsLayer, ScatterplotLayer, SimpleMeshLayer,
  LightingEffect, AmbientLight, DirectionalLight, PathStyleExtension,
} from './deck';
import { makeTerrain, terrainElevAt } from './terrain';
import { drawGraphs } from './graphs';
import { drawTraffic } from './traffic';
import { varioAudio } from './vario-audio';
import { updateSky, getSun, getMoon } from './sky';
import { subjectTrack, shown, scaled, posAt, airborne, headingAt, varioAt, compVarioAt, clampCur, attitudeAt } from './flight-math';
import { GLIDER_MESH, PLANE_MESH, isPowered } from './aircraft-mesh';
import { CHASE, MODEL_SCALE } from './config';
import type { RGB, Pos3, RenderTrack } from './types';

interface PathDatum { color: RGB; pts: Pos3[]; }
interface AircraftDatum { pos: Pos3; orient: [number, number, number]; c: RGB; }

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

const dashExt = new PathStyleExtension({ dash: true });

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
function dynamicLayers() {
  if (!S.ready) return [];
  const k = S.exo, vis = S.TRACKS.filter(shown), off = S.trace === 'off';
  const histStart = (tr: typeof vis[number]) => S.trace === 'window' ? Math.max(tr.rstart, S.cur - S.windowMin * 60) : tr.rstart;
  // Past/future trails split into solid (real data) and dashed (reception-loss
  // gaps, interpolated) runs.
  const pastData: PathDatum[] = [], pastGap: PathDatum[] = [], futData: PathDatum[] = [], futGap: PathDatum[] = [];
  if (!off) for (const tr of vis) {
    pushPaths(pastData, pastGap, tr.color, splitPath(tr, histStart(tr), S.cur, k));
    if (S.trace === 'histfut') pushPaths(futData, futGap, tr.color, splitPath(tr, S.cur, tr.rend, k));
  }
  // 3D aircraft models, oriented to the estimated attitude. deck orientation is
  // [pitch, yaw, roll] with the mesh frame +X=nose, +Y=left, +Z=up, so our
  // attitude maps to [-pitch, 90-heading, roll] (degrees).
  const aircraft = vis.map(tr => {
    if (S.mode === 'fpv' && tr.reg === S.subject) return null;
    if (!airborne(tr, S.cur)) return null;
    const p = posAt(tr, S.cur), a = attitudeAt(tr, S.cur), D = 180 / Math.PI;
    return {
      type: tr.type,
      pos: [p[0], p[1], groundClamp(p) * k] as Pos3,
      orient: [-a.pitch * D, 90 - a.heading, a.roll * D] as [number, number, number],
      c: tr.color,
    };
  }).filter((d): d is AircraftDatum & { type: number } => d !== null);
  const gliders = aircraft.filter(d => !isPowered(d.type));
  const planes = aircraft.filter(d => isPowered(d.type));
  const aircraftMaterial = { ambient: 0.5, diffuse: 0.8, shininess: 24, specularColor: [40, 40, 40] };
  const pastAlpha = (S.mode === 'fpv' || S.solo) ? 215 : 165, trail = S.trace === 'window' ? S.windowMin * 60 : 240;
  return [
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
      getPosition: d => d.pos, getOrientation: d => d.orient, getColor: d => [...d.c, 255],
      sizeScale: MODEL_SCALE, material: aircraftMaterial as any, parameters: { depthTest: true } as any }),
    new SimpleMeshLayer<AircraftDatum>({ id: 'planes', data: planes, mesh: PLANE_MESH as any,
      getPosition: d => d.pos, getOrientation: d => d.orient, getColor: d => [...d.c, 255],
      sizeScale: MODEL_SCALE, material: aircraftMaterial as any, parameters: { depthTest: true } as any }),
    new ScatterplotLayer({ id: 'airfield', data: S.AF ? [{ pos: [S.AF.lon, S.AF.lat, S.AF.elev * k] as Pos3 }] : [], getPosition: (d: any) => d.pos,
      getFillColor: [255, 60, 60], getRadius: 6, radiusUnits: 'pixels', stroked: true, lineWidthMinPixels: 1.5, getLineColor: [255, 255, 255] }),
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
      ? new FirstPersonView({ id: 'fpv', fovy: CHASE.fovy, near: 1, far: 200000 }).makeViewport({ width, height, viewState: (S.mode === 'chase' ? computeChase() : computeFPV()) as any })
      : new MapView({ id: 'main' }).makeViewport({ width, height, viewState: S.mapVS as any });
  } catch (e) { hideSun(); hideMoon(); return; }
  if (!vp || !vp.viewProjectionMatrix) { hideSun(); hideMoon(); return; }
  const u = (vp.distanceScales && vp.distanceScales.unitsPerMeter) || [1, 1, 1];
  const m = vp.viewProjectionMatrix;                                       // column-major
  // Project a direction at infinity (w = 0) to screen px; null if behind/off-screen.
  const project = (toward: [number, number, number]): [string, string] | null => {
    const dx = toward[0] * u[0], dy = toward[1] * u[1], dz = toward[2] * u[2];
    const cw = m[3] * dx + m[7] * dy + m[11] * dz;
    if (cw <= 1e-6) return null;
    const nx = (m[0] * dx + m[4] * dy + m[8] * dz) / cw, ny = (m[1] * dx + m[5] * dy + m[9] * dz) / cw;
    if (Math.abs(nx) > 1.4 || Math.abs(ny) > 1.4) return null;
    return [((nx * 0.5 + 0.5) * vp.width).toFixed(0), ((0.5 - ny * 0.5) * vp.height).toFixed(0)];
  };
  if (sun.up) {
    const p = project(sun.toward);
    if (!p) hideSun();
    else {
      const c = sun.disc.join(',');
      sunEl.style.left = p[0] + 'px'; sunEl.style.top = p[1] + 'px';
      sunEl.style.background = `radial-gradient(circle, rgb(${c}) 0%, rgb(${c}) 17%, rgba(${c},0.5) 32%, rgba(${c},0) 64%)`;
      sunEl.style.display = 'block'; sunShown = true;
    }
  }
  if (moon.up && moon.fraction > 0.04) {                                   // hide a ~new (invisible) moon
    const p = project(moon.toward);
    if (!p) hideMoon();
    else {
      const key = Math.round(moon.fraction * 100) + (moon.waxing ? 'w' : 'n') + moon.disc.join(',');
      if (key !== moonKey) { moonEl.innerHTML = moonSvg(moon.fraction, moon.waxing, moon.disc); moonKey = key; }
      moonEl.style.left = p[0] + 'px'; moonEl.style.top = p[1] + 'px';
      moonEl.style.display = 'block'; moonShown = true;
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

// Create the terrain layer and the deck.gl instance. Called once from main.ts.
export function initDeck(): void {
  S.terrainInst = makeTerrain();
  deckgl = new Deck({
    parent: mapDiv,
    views: [new MapView({ id: 'main' })], viewState: { main: S.mapVS }, controller: { keyboard: false }, effects: [lighting],
    onViewStateChange: ({ viewState, interactionState }: any) => {
      if (S.mode === 'over') {
        S.mapVS = viewState; const it = interactionState || {};
        if (it.isDragging || it.isPanning || it.isRotating || it.isZooming) S.mapTarget = { ...viewState };
      } else if (S.mode === 'fpv' && !S.fpvFollow) { S.freeCam = { bearing: viewState.bearing, pitch: viewState.pitch }; }
    },
    layers: [S.terrainInst, ...dynamicLayers()],
  } as any);
}

export function render(): void {
  updateSky();        // recompute sky colours + sun (before building the layers)
  applySunLight();
  if (S.mode === 'over') {
    deckgl.setProps({
      views: [new MapView({ id: 'main' })], viewState: { main: S.mapVS }, controller: { keyboard: false },
      layers: [S.terrainInst, ...dynamicLayers()],
    } as any);
  } else if (S.mode === 'chase') {
    deckgl.setProps({
      views: [new FirstPersonView({ id: 'fpv', fovy: CHASE.fovy, near: 1, far: 200000 })], viewState: { fpv: computeChase() },
      controller: false, layers: [S.terrainInst, ...dynamicLayers()],
    } as any);
    updateHUD();
  } else {
    deckgl.setProps({
      views: [new FirstPersonView({ id: 'fpv', fovy: 64, near: 1, far: 200000 })], viewState: { fpv: computeFPV() },
      controller: S.fpvFollow ? false : { keyboard: false, scrollZoom: false, inertia: 200 }, layers: [S.terrainInst, ...dynamicLayers()],
    } as any);
    updateHUD();
  }
  feedVarioSound();
  updateCelestial();
  drawGraphs();
  drawTraffic();
}

// Drive the audio variometer from the followed glider's Vz (cockpit & chase only,
// when airborne and sound is on). Uses the same compensated/raw setting as the HUD.
function feedVarioSound(): void {
  const following = S.mode === 'fpv' || S.mode === 'chase';
  const tr = following && S.ready ? subjectTrack() : undefined;
  const active = !!(S.sound && tr && airborne(tr, S.cur));
  const vz = active ? (S.compensated ? compVarioAt(tr!, S.cur) : varioAt(tr!, S.cur)) : 0;
  varioAudio.update(vz, active);
}

// ---- HUD ----
export function updateHUD(): void {
  if (!S.ready) return;
  const tr = subjectTrack(); hudreg.textContent = tr.reg + ' · ' + tr.label;
  if (!airborne(tr, S.cur)) {
    hudhdg.textContent = '—'; hudalt.textContent = '—';
    hudvar.textContent = S.cur < tr.rstart ? t('beforeTk') : t('landed'); hudvar.className = 'vario'; return;
  }
  const p = posAt(tr, S.cur), h = headingAt(tr, S.cur), v = S.compensated ? compVarioAt(tr, S.cur) : varioAt(tr, S.cur);
  hudhdg.textContent = Math.round(h).toString().padStart(3, '0') + '°'; hudalt.textContent = Math.round(p[2]) + ' m';
  hudvar.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' m/s' + (S.compensated ? ' TE' : ''); hudvar.className = 'vario ' + (v >= 0.1 ? 'pos' : (v <= -0.1 ? 'neg' : ''));
}
