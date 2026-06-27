// ============ shared DOM element references ============
// Module scripts are deferred, so the DOM is parsed before this runs.
// Elements used by more than one module are grabbed once here; elements local
// to a single module are grabbed inside that module.
const $ = <T extends Element = HTMLElement>(id: string) =>
  document.getElementById(id) as unknown as T;

export const mapDiv     = $('map');
export const sunEl      = $('sun');
export const moonEl     = $('moon');
export const statusEl   = $('status');
export const subjEl     = $<HTMLSelectElement>('subject');
export const viewsEl    = $('views');
export const cammodeEl  = $('cammode');
export const traceEl    = $<HTMLSelectElement>('trace');
export const smoothBtn  = $<HTMLButtonElement>('smoothBtn');
export const compBtn    = $<HTMLButtonElement>('compBtn');
export const bankBtn    = $<HTMLButtonElement>('bankBtn');
export const soundBtn   = $<HTMLButtonElement>('soundBtn');
export const trafficModeEl = $<HTMLSelectElement>('trafficMode');
export const trafficCanvas = $<HTMLCanvasElement>('trafficCanvas');
export const graphModeEl= $<HTMLSelectElement>('graphMode');
export const graphClose = $<HTMLButtonElement>('graphClose');
export const graphCanvas= $<HTMLCanvasElement>('graphCanvas');
export const graphTabs  = $('graphTabs');
export const winEl      = $<HTMLInputElement>('win');
export const winval     = $('winval');
export const playBtn    = $<HTMLButtonElement>('play');
export const segEl      = $('speeds');
export const exoEl      = $<HTMLInputElement>('exo');
export const exval      = $('exval');
export const pitchEl    = $<HTMLInputElement>('pitch');
export const pitchval   = $('pitchval');
export const scrub      = $<HTMLInputElement>('scrub');
export const clkEl      = $('clk');
export const lglist     = $('lglist');
export const rose       = $<SVGGElement>('rose');
export const altsl      = $<HTMLInputElement>('altsl');
export const icaoEl     = $<HTMLInputElement>('icao');
export const fblink     = $<HTMLAnchorElement>('fblink');
export const acEl       = $('aclist');
export const dateEl     = $<HTMLInputElement>('date');
export const loadBtn    = $<HTMLButtonElement>('load');
export const hudreg     = $('hudreg');
export const hudhdg     = $('hudhdg');
export const hudalt     = $('hudalt');
export const hudvar     = $('hudvar');
export const langEl     = $<HTMLSelectElement>('lang');
export const discEl     = $<HTMLElement>('disclaimer');
export const infoBtn    = $<HTMLButtonElement>('infoBtn');
export const collapseBtn= $<HTMLButtonElement>('collapseBtn');
export const liveBtn    = $<HTMLButtonElement>('liveBtn');
