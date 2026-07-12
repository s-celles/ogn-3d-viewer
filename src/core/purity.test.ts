// ============ architecture guard: src/core stays pure ============
// src/core is the soaring kernel meant to be shared with other apps (a flight
// computer has no map renderer and may have no DOM at all). To stay shareable it
// must depend on NOTHING app-specific: no deck.gl/luma, no shared mutable app
// state (src/state.ts), no browser globals. This test fails the build if a new
// import or a stray `document.` sneaks in — the boundary is checked, not trusted.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CORE = join(import.meta.dir);

/** Every .ts file under src/core (recursively), test files included. */
function coreFiles(dir = CORE, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) coreFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
const rel = (p: string) => p.slice(CORE.length + 1);
const sources = coreFiles().map(p => ({ file: rel(p), text: readFileSync(p, 'utf8') }));
/** Module specifiers of every static/dynamic import in a file. */
const imports = (text: string): string[] =>
  [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

test('core has files to guard', () => {
  expect(sources.length).toBeGreaterThan(3);
});

test('core imports no app-only or rendering package', () => {
  // deck.gl/luma are the viewer's renderer; a flight computer must not inherit them.
  const banned = [/^@deck\.gl\//, /^@luma\.gl\//, /^marked$/, /^qrcode-generator$/];
  for (const { file, text } of sources)
    for (const spec of imports(text))
      for (const re of banned)
        expect(`${file} imports ${spec}`).not.toMatch(new RegExp(`imports ${re.source.replace(/[\^$]/g, '')}`));
});

test('core never reaches outside itself (except bundled data assets)', () => {
  // A relative import that climbs out of src/core would drag app code back in. Resolve
  // it — core has subdirectories, so `../geo` from core/lift is *inside* the kernel while
  // `../state` from core is not. Bundled data files (../../data/**) are inert assets.
  for (const { file, text } of sources)
    for (const spec of imports(text)) {
      if (!spec.startsWith('.')) continue;                       // bare package: covered above
      const target = join(CORE, dirname(file), spec);            // absolute, normalised
      const escapes = !target.startsWith(CORE + '/');
      const isDataAsset = /^\.\.\/\.\.\/data\//.test(spec);
      expect(`${file} → ${spec}`).toBe(escapes && !isDataAsset ? 'MUST NOT ESCAPE src/core' : `${file} → ${spec}`);
    }
});

test('core touches no browser global (DOM / storage / location)', () => {
  // The kernel must run headless (Bun, Node, a worker, an embedded runtime).
  const banned = /\b(document|localStorage|sessionStorage|navigator|location|HTMLElement|AudioContext)\b\s*\./g;
  for (const { file, text } of sources) {
    const code = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');   // ignore comments
    const hits = [...code.matchAll(banned)].map(m => m[1]);
    expect(`${file}: ${hits.join(',')}`).toBe(`${file}: `);
  }
});
