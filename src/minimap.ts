// ============ inset 2D minimap ============
// A small flat slippy-map in the corner (own its own lightweight Deck instance),
// shown in the immersive views (cockpit / chase) to keep your bearings: the
// selected base map served as plain 2D tiles, the followed glider's track, and a
// heading arrow for every airborne aircraft. North-up, follows the subject.

import { Deck, MapView, TileLayer, BitmapLayer, PathLayer, ScatterplotLayer } from './deck';
import { S } from './state';
import { BASEMAPS, DEFAULT_BASEMAP } from './config';
import { subjectTrack, clampCur, posAt, headingAt, airborne } from './flight-math';
import { minimapDiv } from './dom';
import type { RenderTrack } from './types';

const ZOOM = 10;            // fixed follow zoom (~18 km across at mid-latitudes)
const TICK_M = 900;         // heading-tick length, metres (constant screen size at a fixed zoom)

let deck: any = null;

// Web-mercator tile → geographic edges (avoids depending on deck's tile.bbox shape).
const tileLng = (x: number, z: number) => x / 2 ** z * 360 - 180;
const tileLat = (y: number, z: number) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

/** Destination point a distance `d` (m) from [lon,lat] along bearing `brg` (deg). */
function dest(lon: number, lat: number, brg: number, d: number): [number, number] {
  const R = 6371000, dr = d / R, b = brg * Math.PI / 180;
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return [lo2 * 180 / Math.PI, la2 * 180 / Math.PI];
}

// Created lazily the first time the minimap is actually shown, so its Deck reads
// a real (non-zero) container size and we never spin up a WebGL context for users
// who stay in the overview.
function ensureDeck(): void {
  if (deck) return;
  deck = new Deck({
    parent: minimapDiv,
    views: [new MapView({ id: 'mm' })],
    viewState: { mm: { longitude: 2, latitude: 46, zoom: ZOOM, pitch: 0, bearing: 0 } },
    controller: false,
    layers: [],
  } as any);
}

function baseTileLayer(): any {
  const bm = BASEMAPS[S.basemap] || BASEMAPS[DEFAULT_BASEMAP];
  return new TileLayer({
    id: 'mm-base-' + S.basemap, data: bm.url, minZoom: 0, maxZoom: bm.imgMax, tileSize: 256, maxCacheSize: 120,
    // Fetch the image ourselves (plain imagery → an ImageBitmap texture, no DEM
    // decode, so none of the terrain worker-decode issues apply).
    getTileData: async (tile: any): Promise<ImageBitmap | null> => {
      const { x, y, z } = tile.index;
      const url = bm.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      try {
        const res = await fetch(url, { signal: tile.signal }); if (!res.ok) return null;
        return await createImageBitmap(await res.blob());
      } catch { return null; }
    },
    renderSubLayers: (props: any) => {
      const img = props.data as ImageBitmap | null; if (!img) return null;
      const { x, y, z } = props.tile.index;
      const bounds = [tileLng(x, z), tileLat(y + 1, z), tileLng(x + 1, z), tileLat(y, z)];   // [W,S,E,N]
      return new BitmapLayer(props, { image: img, bounds } as any);
    },
  } as any);
}

/** Rebuild the minimap's layers + recentre on the followed glider. Cheap no-op
 *  when the minimap is hidden (overview, off, or not ready). */
export function updateMinimap(): void {
  if (!S.ready || !S.minimap) return;   // hidden by CSS too; skip the work
  ensureDeck();
  const tr = subjectTrack();
  if (!tr) { deck.setProps({ layers: [baseTileLayer()] }); return; }
  const t = clampCur(tr), cur = posAt(tr, t), hdg = headingAt(tr, t);

  const full = tr.rel.map(p => [p[0], p[1]] as [number, number]);
  const flown = tr.rel.filter(p => p[3] <= t).map(p => [p[0], p[1]] as [number, number]);
  // Other airborne aircraft, as small coloured dots for context.
  const others = S.TRACKS.filter((o: RenderTrack) => o !== tr && airborne(o, S.cur))
    .map((o: RenderTrack) => { const p = posAt(o, clampCur(o)); return { p: [p[0], p[1]] as [number, number], c: o.color }; });

  deck.setProps({
    viewState: { mm: { longitude: cur[0], latitude: cur[1], zoom: ZOOM, pitch: 0, bearing: 0 } },
    layers: [
      baseTileLayer(),
      new PathLayer({ id: 'mm-full', data: [full], getPath: (d: any) => d, getColor: [255, 255, 255, 70], getWidth: 1.5, widthUnits: 'pixels', parameters: { depthTest: false } } as any),
      new PathLayer({ id: 'mm-flown', data: [flown], getPath: (d: any) => d, getColor: [...tr.color, 235], getWidth: 2.5, widthUnits: 'pixels', parameters: { depthTest: false } } as any),
      new ScatterplotLayer({ id: 'mm-others', data: others, getPosition: (d: any) => d.p, getFillColor: (d: any) => [...d.c, 200], getRadius: 3, radiusUnits: 'pixels', stroked: true, getLineColor: [0, 0, 0, 160], lineWidthUnits: 'pixels', getLineWidth: 0.5 } as any),
      // Own-ship: a heading tick + a dot at the followed glider.
      new PathLayer({ id: 'mm-hdg', data: [[[cur[0], cur[1]], dest(cur[0], cur[1], hdg, TICK_M)]], getPath: (d: any) => d, getColor: [255, 255, 255, 255], getWidth: 2, widthUnits: 'pixels', parameters: { depthTest: false } } as any),
      new ScatterplotLayer({ id: 'mm-ship', data: [{ p: [cur[0], cur[1]] }], getPosition: (d: any) => d.p, getFillColor: [255, 60, 60, 255], getRadius: 5, radiusUnits: 'pixels', stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5 } as any),
    ],
  });
}
