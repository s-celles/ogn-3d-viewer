// Build-time constants injected by scripts/build.ts via Bun's `define`. In dev
// (plain `bun build`, no define) the identifiers are undefined, so `typeof`
// guards fall back without throwing.
declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';
export const GIT_HASH = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : 'dev';
