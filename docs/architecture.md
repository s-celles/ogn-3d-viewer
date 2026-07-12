# Architecture: the `core/` boundary

OGN 3D Viewer is a browser app, but a good part of what it computes is not about
browsers at all: parsing an IGC log, fitting a glider polar, deriving the netto
vario, modelling slope lift or a thermal potential. That knowledge is *soaring
domain*, not *3D rendering*, and it is meant to be shared with other soaring
software (e.g. a flight computer, which has a map but no deck.gl, and may run
with no DOM at all).

So the source tree has two halves, and one rule between them.

## The two halves

| | `src/core/` — the soaring kernel | `src/` — the app |
|---|---|---|
| Contains | domain types, IGC/GPX/KML import, polar & netto, lift colour language | app state, deck.gl layers, DOM/UI, terrain tiles, playback |
| May import | itself, bundled data assets (`data/**`), pure npm packages | anything, including `core/` |
| Must never import | `src/state.ts`, deck.gl/luma, the DOM | — |
| Runs under | Bun/Node/a worker, headless | a browser |

Dependencies point **one way only**: `app → core`. The kernel never knows the
app exists.

## The rule, and why it is a test

The boundary is enforced by `src/core/purity.test.ts`, which reads every file
under `src/core/` and fails the suite if it finds:

- an import of a rendering/app-only package (`@deck.gl/*`, `@luma.gl/*`, …);
- a relative import climbing out of `src/core/` (only `../../data/**` assets are
  allowed — they are inert text/CSV, not code);
- a browser global (`document.`, `localStorage.`, `navigator.`, `location.`, …).

A boundary that is only written down in a README erodes on the first hurried
commit. This one is checked on every `bun test`, so it cannot erode silently.

## Why it matters: `S` and `deck`

Two couplings, if left unchecked, make any module unshareable:

1. **`import { S } from './state'`** — the single mutable app state. A module
   that reads `S` can only ever run inside *this* app, configured *this* way.
   Core modules take their inputs as **explicit parameters** instead.
2. **`import … from './deck'`** — several app modules do not *compute* a field,
   they directly *return a deck.gl layer*. Core modules return **plain data**
   (numbers, arrays, fields); turning that data into a mesh, a 2D overlay or an
   audio tone is the app's job.

Hence the shape a module takes when it moves into the kernel:

```
core/…/x.ts     computeX(inputs, params) → plain data     ← shareable, testable, headless
src/x.ts        computeX(…) → SimpleMeshLayer             ← this app's rendering of it
```

## Current contents of `core/`

- `types.ts` — the domain types (`TrackPoint`, `ImportedTrack`, `ImportedFile`).
  `src/types.ts` re-exports them, so app modules keep a single import site.
- `igc.ts` — IGC B-record / H-record parsing, timezone offsets, a bounded pool.
- `track-import.ts` — IGC / GPX / KML → a common `ImportedFile`.
- `polar.ts` — the two-term polar `w(V) = A·V³ + B/V`, `.plr` import, netto,
  minimum sink, super-netto.
- `liftviz.ts` — the shared colour language for vertical air motion.

## Moving a module into `core/`

The kernel grows by *purification*, one module at a time, never by a big-bang
move:

1. Write the test first, against the API you *want* (explicit inputs, no `S`).
2. Split the module: the computation (pure, → `core/`) and its rendering (stays
   in `src/`, consumes the computed data and builds the deck.gl layer).
3. Replace every `S.foo` read by an explicit parameter; the app passes `S.foo`
   at the call site.
4. Run `bun test` — the purity guard must stay green — and `bun run typecheck`.

The app must remain fully working after each step.
