// ============ code → country flag (display helper) ============
// Best-effort mapping from an airfield code (ICAO, or a national/FAA identifier)
// to an ISO-2 country and its flag emoji. Only the common gliding countries are
// covered; unknown codes just get no flag.
const ICAO_ISO: Record<string, string> = {
  LF: 'FR', LI: 'IT', LE: 'ES', LP: 'PT', LG: 'GR', LO: 'AT', LS: 'CH', LK: 'CZ', LZ: 'SK', LJ: 'SI', LH: 'HU', LR: 'RO', LB: 'BG', LT: 'TR', LM: 'MT', LC: 'CY', LL: 'IL',
  ED: 'DE', ET: 'DE', EG: 'GB', EH: 'NL', EB: 'BE', EL: 'LU', EK: 'DK', EN: 'NO', ES: 'SE', EF: 'FI', EP: 'PL', EV: 'LV', EY: 'LT', EE: 'EE', EI: 'IE',
  NZ: 'NZ', FA: 'ZA', FY: 'NA', SA: 'AR', SC: 'CL', SB: 'BR', RJ: 'JP',
};

/** ISO 3166-1 alpha-2 for a code, or '' if unknown. */
export function codeCountry(code: string): string {
  const c = (code || '').toUpperCase();
  return ICAO_ISO[c.slice(0, 2)] || ({ K: 'US', Y: 'AU', C: 'CA', Z: 'CN' } as Record<string, string>)[c[0]] || '';
}
/** ISO-2 → flag emoji (regional indicator letters); '' for empty/invalid. */
export function flag(iso: string): string {
  return /^[A-Za-z]{2}$/.test(iso || '') ? iso.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0))) : '';
}
/** Flag emoji for an airfield code (or '' if the country is unknown). */
export const codeFlag = (code: string): string => flag(codeCountry(code));
