// ============ viewer: deck.gl instance, dynamic layers, HUD ============
import { S } from './state';
import { t } from './i18n';
import { mapDiv, hudreg, hudhdg, hudalt, hudvar } from './dom';
import {
  Deck, MapView, FirstPersonView, PathLayer, TripsLayer, ScatterplotLayer, SimpleMeshLayer,
  LightingEffect, AmbientLight, DirectionalLight,
} from './deck';
import { makeTerrain } from './terrain';
import { varioAudio } from './vario-audio';
import { updateSky, getSun } from './sky';
import { subjectTrack, shown, scaled, posAt, airborne, slice, headingAt, varioAt, compVarioAt, clampCur, attitudeAt } from './flight-math';
import { GLIDER_MESH, PLANE_MESH, isPowered } from './aircraft-mesh';
import { CHASE, MODEL_SCALE } from './config';
import type { RGB, Pos3 } from './types';

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

// The glider/airfield/terrain layers, rebuilt every frame from the cursor.
function dynamicLayers() {
  if (!S.ready) return [];
  const k = S.exo, vis = S.TRACKS.filter(shown);
  const histStart = (tr: typeof vis[number]) => S.trace === 'window' ? Math.max(tr.rstart, S.cur - S.windowMin * 60) : tr.rstart;
  const pastData = vis.map(tr => {
    const pts = slice(tr, histStart(tr), S.cur).map(p => [p[0], p[1], p[2] * k] as Pos3);
    return pts.length >= 2 ? { color: tr.color, pts } : null;
  }).filter((d): d is PathDatum => d !== null);
  const futData = (S.trace === 'histfut') ? vis.map(tr => {
    const pts = slice(tr, S.cur, tr.rend).map(p => [p[0], p[1], p[2] * k] as Pos3);
    return pts.length >= 2 ? { color: tr.color, pts } : null;
  }).filter((d): d is PathDatum => d !== null) : [];
  // 3D aircraft models, oriented to the estimated attitude. deck orientation is
  // [pitch, yaw, roll] with the mesh frame +X=nose, +Y=left, +Z=up, so our
  // attitude maps to [-pitch, 90-heading, roll] (degrees).
  const aircraft = vis.map(tr => {
    if (S.mode === 'fpv' && tr.reg === S.subject) return null;
    if (!airborne(tr, S.cur)) return null;
    const p = posAt(tr, S.cur), a = attitudeAt(tr, S.cur), D = 180 / Math.PI;
    return {
      type: tr.type,
      pos: [p[0], p[1], p[2] * k] as Pos3,
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
    new PathLayer<PathDatum>({ id: 'past', data: pastData, getPath: d => d.pts, getColor: d => [...d.color, pastAlpha],
      getWidth: 2, widthUnits: 'pixels', jointRounded: true, capRounded: true, parameters: { depthTest: true } as any }),
    new TripsLayer({ id: 'trips', data: vis, getPath: (tr: any) => scaled(tr), getTimestamps: (tr: any) => tr.rel.map((p: number[]) => p[3]), getColor: (tr: any) => tr.color,
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
    ...sunLayers(),
  ];
}

// The sun disc + glow, drawn on top (depthTest off) at a far point in the sun's
// direction so it sits in the sky. Distance is kept inside the views' far plane.
function sunLayers() {
  const s = getSun();
  if (!s.up || !S.AF) return [];
  const [tx, ty, tz] = s.toward, D = 60000; // 60 km along the 3D sun direction (inside the far plane)
  const lon = S.AF.lon + (D * tx) / (111320 * Math.cos(S.AF.lat * Math.PI / 180));
  const lat = S.AF.lat + (D * ty) / 111320;
  const pos = [lon, lat, (S.AF.elev || 0) + D * tz] as Pos3;
  const data = [{ pos }], c = s.disc;
  return [
    new ScatterplotLayer({ id: 'sun-glow', data, getPosition: (d: any) => d.pos, getFillColor: [...c, 45] as any,
      getRadius: 46, radiusUnits: 'pixels' }),
    new ScatterplotLayer({ id: 'sun', data, getPosition: (d: any) => d.pos, getFillColor: [...c, 255] as any,
      getRadius: 15, radiusUnits: 'pixels' }),
  ];
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
  const base = { longitude: p[0], latitude: p[1], position: [0, 0, p[2] * S.exo + 3] };
  if (!S.fpvFollow) return { ...base, bearing: S.freeCam.bearing, pitch: S.freeCam.pitch };
  const bearing = headingAt(tr, time), pitch = S.fpvPitch;
  if (!S.bank) return { ...base, bearing, pitch }; // level horizon
  const roll = attitudeAt(tr, time).roll;
  return { ...base, bearing, pitch, up: rollUp(forwardVec(bearing, pitch), roll) };
}

// Chase cam: MapView centred on the glider, looking forward from behind/above.
function computeChase() {
  const tr = subjectTrack(), time = clampCur(tr), p = posAt(tr, time);
  return { longitude: p[0], latitude: p[1], zoom: CHASE.zoom, pitch: CHASE.pitch, bearing: headingAt(tr, time), maxPitch: 85 };
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
      views: [new MapView({ id: 'main' })], viewState: { main: computeChase() }, controller: false,
      layers: [S.terrainInst, ...dynamicLayers()],
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
