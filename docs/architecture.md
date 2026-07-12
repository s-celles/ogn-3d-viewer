# Architecture: the kernel is a dependency

OGN 3D Viewer is a browser app, but a good part of what it computes is not about browsers
at all: parsing an IGC log, fitting a glider polar, deriving the netto vario, sampling the
ground out of a DEM, reading the day's atmosphere, predicting slope lift or a thermal
field. That knowledge is *soaring domain*, not *3D rendering*. It is meant to be shared
with other soaring software — a flight computer has a map but no deck.gl, and may run with
no DOM at all.

So it no longer lives here.

## Where it lives

**[soaring-core](https://github.com/s-celles/soaring-core)** — an AGPL-3.0 package this app
depends on, pinned in `package.json`:

```json
"soaring-core": "github:s-celles/soaring-core#v0.1.0"
```

| | `soaring-core` — the kernel | `src/` — this app |
|---|---|---|
| Contains | domain types, IGC/GPX/KML import, polar & netto, geodesy & the Terrarium DEM codec, ephemeris, the atmosphere, air-mass detection from tracks, four predicted lift fields | app state, deck.gl layers, DOM/UI, tile fetching and caching, playback |
| May import | itself, its bundled data assets, pure npm packages | anything, including the kernel |
| Must never import | app state, deck.gl/luma, the DOM | — |
| Runs under | Bun/Node/a worker, headless | a browser |

Dependencies point **one way only**: `app → kernel`. The kernel does not know this app
exists — and now it *cannot*: it is an external package, so an import back into `src/`
would not even resolve.

## Why the boundary exists: `S` and `deck`

Two couplings, left unchecked, make any module unshareable. This is the whole argument,
and it is worth restating because it is what every extraction had to undo:

1. **`import { S } from './state'`** — the single mutable app state. A module that reads
   `S` can only ever run inside *this* app, configured *this* way. Kernel functions take
   their inputs as **explicit parameters** instead.
2. **`import … from './deck'`** — several modules did not *compute* a field, they directly
   *returned a deck.gl layer*. Kernel functions return **plain data** (numbers, arrays,
   fields); turning that into a mesh, a 2D overlay or an audio tone is this app's job.

Hence the shape every module took on its way out:

```
soaring-core/…/x    computeX(inputs, params) → plain data   ← shareable, testable, headless
src/layers/x.ts     computeX(…) → SimpleMeshLayer           ← this app's rendering of it
```

And what the kernel needs from the world arrives as a **function**, never as a fetch:

```ts
type ElevSampler = (lon: number, lat: number) => number | null;   // null = UNKNOWN, never a fake zero
type WindProfile = (alt: number) => [number, number] | null;
interface Probe { rstart: number; rend: number; at: (t: number) => readonly [number, number, number] }
```

That is why the same `elevAtFromTiles` serves this app's CDN tiles and a flight computer's
offline data pack. `src/terrain.ts` and `src/dem.ts` keep only the fetching and caching;
`src/weather.ts` keeps the network, the per-location cache and the sandbox knobs, and hands
the kernel a payload to parse.

## What enforces it

Nothing here, any more — and that is the point. The guards moved with the kernel and now
run in *its* CI, against a repo that has no renderer to lean on:

- **The compiler.** `soaring-core`'s tsconfig drops `DOM` from `lib`. A browser global is a
  *compile* error, not a review comment.
- **`purity.test.ts`.** It guards what the compiler cannot see: a rendering package sneaking
  into an import, a relative path climbing out of `src/`, a `document.` inside a string.
- **The package boundary itself.** This app cannot pollute the kernel by accident, because
  the kernel is not a directory it can reach into.

A boundary written down in a README erodes on the first hurried commit. This one is checked
by two CIs and by the module resolver.

## How it got here

The kernel was not designed and then filled. It grew *inside this repo*, by purification —
one module at a time, test first, behaviour unchanged, over eighteen commits — and was then
lifted out with its history intact (`git subtree split`). Each of those commits explains why
a boundary exists, and several record a bug the purification uncovered: a spiral descent
reported as a thermal, a colour scale that could not survive its own calibration, cloud
streets anchored to the camera instead of the ground.

That order matters. A kernel extracted from working code, with its history, is a set of
answers. A kernel designed up front is a set of guesses.

## Working on both at once

```bash
cd soaring-core  && bun link
cd ogn-3d-viewer && bun link soaring-core   # symlink: changes land immediately
bun install                                  # back to the pinned version
```

`bun.lock` pins the annotated tag *object* plus a `sha512` of the extracted package, so a
force-moved tag makes `bun install --frozen-lockfile` fail rather than silently install
something else.
