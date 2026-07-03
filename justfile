# OGN 3D Viewer — task runner (https://github.com/casey/just)
# Mirrors the package.json scripts; run `just` to list the recipes.

# Port for the local preview server
port := "3000"

# List available recipes
default:
    @just --list

# Install dependencies (frozen lockfile, like CI)
install:
    bun install --frozen-lockfile

# Dev: rebuild dist/ on every change AND serve it on {{port}} (needs python3).
# Bun's --watch only bundles; it doesn't serve, so we run a static server too.
# Reload the browser to see changes (no HMR). Ctrl-C stops both.
dev port=port:
    #!/usr/bin/env bash
    set -euo pipefail
    bun run dev &
    watcher=$!
    trap 'kill $watcher 2>/dev/null' EXIT
    until [ -f dist/index.html ]; do sleep 0.1; done
    echo "serving http://localhost:{{port}}/ (Ctrl-C to stop)"
    python3 -m http.server -d dist {{port}}

# Production build → dist/ (bundle + PWA manifest/icons/service worker)
build:
    bun run build

# Build once, then serve dist/ locally on {{port}} (needs python3)
serve port=port:
    bun run scripts/build.ts && python3 -m http.server -d dist {{port}}

# Run the test suite
test:
    bun test

# Type-check only (no emit)
typecheck:
    tsc --noEmit

# Everything CI runs before deploying: type-check, test, build
check: typecheck test build

# Refresh the flightbook_checked column in data/spots.csv (queries OGN FlightBook)
check-spots:
    bun run scripts/check-spots.ts

# Remove build output
clean:
    rm -rf dist
