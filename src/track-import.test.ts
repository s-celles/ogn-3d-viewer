import { test, expect } from 'bun:test';
import { parseGPX, parseKML, parseTrackFile } from './track-import';

const GPX = `<?xml version="1.0"?>
<gpx><trk><name>Flight</name><trkseg>
<trkpt lat="45.5" lon="6.1"><ele>1200</ele><time>2024-06-15T09:30:00Z</time></trkpt>
<trkpt lat="45.6" lon="6.2"><ele>1300</ele><time>2024-06-15T09:30:10Z</time></trkpt>
</trkseg></trk></gpx>`;

test('parseGPX reads timed trkpts as [lon,lat,alt,sod] + date', () => {
  const r = parseGPX(GPX);
  expect(r.date).toBe('2024-06-15');
  expect(r.tracks.length).toBe(1);
  expect(r.tracks[0].name).toBe('Flight');
  expect(r.tracks[0].pts[0]).toEqual([6.1, 45.5, 1200, 34200]); // 09:30:00 UTC
  expect(r.tracks[0].pts[1]).toEqual([6.2, 45.6, 1300, 34210]);
});

test('parseGPX without <time> falls back to sequential seconds, attr order agnostic, self-closing', () => {
  const gpx = `<gpx><trk><trkseg>
    <trkpt lon="6.1" lat="45.5"/>
    <trkpt lat="45.6" lon="6.2"><ele>1300</ele></trkpt>
  </trkseg></trk></gpx>`;
  const r = parseGPX(gpx);
  expect(r.date).toBeNull();
  expect(r.tracks[0].pts.map(p => p[3])).toEqual([0, 1]); // synthesized times
  expect(r.tracks[0].pts[0]).toEqual([6.1, 45.5, 0, 0]);  // lon-before-lat handled
});

test('parseKML gx:Track zips <when> with <gx:coord> (lon lat alt)', () => {
  const kml = `<kml><Placemark><name>F-X</name><gx:Track>
    <when>2024-06-15T09:30:00Z</when><when>2024-06-15T09:30:10Z</when>
    <gx:coord>6.1 45.5 1200</gx:coord><gx:coord>6.2 45.6 1300</gx:coord>
  </gx:Track></Placemark></kml>`;
  const r = parseKML(kml);
  expect(r.date).toBe('2024-06-15');
  expect(r.tracks[0].pts[0]).toEqual([6.1, 45.5, 1200, 34200]);
});

test('parseKML LineString (no time) → sequential, comma-separated lon,lat,alt', () => {
  const kml = `<kml><Placemark><name>Route</name><LineString><coordinates>
    6.1,45.5,1200 6.2,45.6,1300
  </coordinates></LineString></Placemark></kml>`;
  const r = parseKML(kml);
  expect(r.date).toBeNull();
  expect(r.tracks[0].pts).toEqual([[6.1, 45.5, 1200, 0], [6.2, 45.6, 1300, 1]]);
});

test('parseTrackFile dispatches by extension', () => {
  expect(parseTrackFile('a.gpx', GPX).tracks[0].pts[0][3]).toBe(34200);
  const igc = 'HFDTE150624\nB0930004530000N00606000EA0000001200\nB0930104530600N00612000EA0000001300\n';
  const r = parseTrackFile('a.igc', igc);
  expect(r.date).toBe('2024-06-15');
  expect(r.tracks[0].type).toBe(1);
  expect(r.tracks[0].pts.length).toBe(2);
});
