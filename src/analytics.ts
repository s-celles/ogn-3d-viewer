// ============ privacy-respecting usage analytics (GoatCounter) ============
// GoatCounter is open-source, cookieless and stores no personal data and no IP.
// We load it only on the canonical deployment (so forks and local runs never
// report to this account) and skip it entirely when the visitor signals they do
// not want to be tracked (Do Not Track or Global Privacy Control). It just
// counts page views; there is nothing to opt into and nothing stored on device.
// The disclosure lives in the info panel (see i18n `disc`).

const ENDPOINT = 'https://s-celles.goatcounter.com/count';
const CANONICAL_HOST = 's-celles.github.io';

export function initAnalytics(): void {
  const n = navigator as any, w = window as any;
  // Honour Do Not Track / Global Privacy Control.
  if (n.doNotTrack === '1' || n.doNotTrack === 'yes' || w.doNotTrack === '1' || n.msDoNotTrack === '1' || n.globalPrivacyControl === true) return;
  // Only the canonical deployment counts (forks, previews and localhost don't).
  if (location.hostname !== CANONICAL_HOST) return;

  // Record the bare path only. The app's deep links carry a query string
  // (?icao=…&date=…&reg=…&t=…); without this every share link would count as a
  // distinct page and shatter the stats. Also keeps those params (airfield,
  // aircraft, moment) out of the analytics entirely.
  (window as any).goatcounter = { path: () => location.pathname };

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', ENDPOINT);
  document.head.appendChild(s);
}
