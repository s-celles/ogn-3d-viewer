// ============ shared DOM element references ============
// Module scripts are deferred, so the DOM is parsed before this runs.
// Elements used by more than one module are grabbed once here; elements local
// to a single module are grabbed inside that module.
const $ = id => document.getElementById(id);

export const mapDiv     = $('map');
export const statusEl   = $('status');
export const subjEl     = $('subject');
export const viewsEl    = $('views');
export const cammodeEl  = $('cammode');
export const traceEl    = $('trace');
export const winEl      = $('win');
export const winval     = $('winval');
export const playBtn    = $('play');
export const segEl      = $('speeds');
export const exoEl      = $('exo');
export const exval      = $('exval');
export const pitchEl    = $('pitch');
export const pitchval   = $('pitchval');
export const scrub      = $('scrub');
export const clkEl      = $('clk');
export const lglist     = $('lglist');
export const rose       = $('rose');
export const icaoEl     = $('icao');
export const acEl       = $('aclist');
export const dateEl     = $('date');
export const loadBtn    = $('load');
export const hudreg     = $('hudreg');
export const hudhdg     = $('hudhdg');
export const hudalt     = $('hudalt');
export const hudvar     = $('hudvar');
export const langEl     = $('lang');
export const discEl     = $('disclaimer');
export const infoBtn    = $('infoBtn');
export const collapseBtn= $('collapseBtn');
export const liveBtn    = $('liveBtn');
