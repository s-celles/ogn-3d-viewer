// ============ service-worker tile-cache cap ============
// Tell the service worker the desired persistent tile-cache size (the device
// default × the user's cache-size setting). The worker persists it, so it holds
// across restarts. No-op in dev (no controlling worker).
import { S } from './state';
import { DISK_TILES_BASE } from './config';

export function postCacheCap(): void {
  const cap = Math.max(100, Math.round(DISK_TILES_BASE * S.cacheScale));
  navigator.serviceWorker?.controller?.postMessage({ type: 'tileMax', value: cap });
}
