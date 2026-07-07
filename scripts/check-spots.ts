// Verify each spot's `code` against the OGN FlightBook and stamp the check date
// into the `flightbook_checked` column of data/spots/spots.csv (empty = not found).
// Run:  just check-spots   (or: bun run scripts/check-spots.ts)
//
// `blurb` is the last column and may contain commas, so it's kept verbatim; every
// other field is comma-separated and stable.
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://flightbook.glidernet.org';
const root = new URL('..', import.meta.url).pathname;
const path = `${root}data/spots/spots.csv`;
const today = new Date().toISOString().slice(0, 10);

const csv = await readFile(path, 'utf8');
const lines = csv.trim().split(/\r?\n/);
const cols = lines[0].split(',');
const iCode = cols.indexOf('code');
const iChk = cols.indexOf('flightbook_checked');
const nBefore = cols.length - 1;   // number of comma fields before the free-form blurb
if (iCode < 0 || iChk < 0) { console.error('spots.csv is missing code / flightbook_checked columns'); process.exit(1); }

// A code is "on FlightBook" if its logbook resolves to an airfield with coordinates.
async function onFlightbook(code: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/logbook/${encodeURIComponent(code)}/${today}`);
    if (!r.ok) return false;
    const j: any = await r.json();
    return !!(j && j.airfield && j.airfield.latlng);
  } catch { return false; }
}

const out = [lines[0]];
let ok = 0, miss = 0;
for (let i = 1; i < lines.length; i++) {
  const p = lines[i].split(',');
  const before = p.slice(0, nBefore), blurb = p.slice(nBefore).join(',');
  const present = await onFlightbook(before[iCode]);
  before[iChk] = present ? today : '';
  present ? ok++ : miss++;
  console.log(`${present ? '✓' : '·'} ${before[iCode].padEnd(6)} ${before[1]}`);
  out.push([...before, blurb].join(','));
  await new Promise(res => setTimeout(res, 250));   // be gentle with the API
}
await writeFile(path, out.join('\n') + '\n');
console.log(`\nFlightBook: ${ok} present · ${miss} not found → ${path}`);
