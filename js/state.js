// ============ shared mutable state ============
// All the app's mutable variables live here as properties of S so that every
// module reads/writes the same live values (ES module imports are read-only
// bindings, so plain `let` exports could not be reassigned across files).
export const S = {
  // filled by loadData / rebuild
  AF:null, G0:0, G1:0, SPAN:1, TRACKS:[], ready:false,
  exo:2.0, cur:0, playing:false, speed:30, solo:null,
  mode:'over', subject:null, fpvPitch:6, fpvFollow:true, freeCam:{bearing:0,pitch:6},
  trace:'window', windowMin:10,
  live:false, liveTimer:null,
  INIT:{longitude:2.4, latitude:46.6, zoom:4.6, pitch:0, bearing:0, maxPitch:85},
  mapVS:null, mapTarget:null,
  // source tracks (path times = UTC seconds of day). RAW is the merge target for
  // live refreshes; rebuild() turns it into the render-ready TRACKS.
  RAW:[], CURAF:null, CURTZ:0,
  COLOR:{}, colorN:0,
  // current UI language (fr/en), auto-detected from the browser
  lang: (navigator.language||'').toLowerCase().startsWith('fr') ? 'fr' : 'en',
  // current terrain TileLayer instance (rebuilt when exaggeration changes)
  terrainInst:null,
};
S.mapVS    = {...S.INIT};
S.mapTarget= {...S.INIT};
