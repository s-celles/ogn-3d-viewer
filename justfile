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
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)
    echo "serving http://localhost:{{port}}/  ·  LAN (phone, same Wi-Fi): http://$ip:{{port}}/  (Ctrl-C to stop)"
    python3 -m http.server --bind 0.0.0.0 -d dist {{port}}

# Production build → dist/ (bundle + PWA manifest/icons/service worker)
build:
    bun run build

# Build once, then serve dist/ on all interfaces (0.0.0.0) — reachable from a
# phone on the same Wi-Fi at the printed LAN URL. Needs python3.
serve port=port:
    #!/usr/bin/env bash
    set -euo pipefail
    bun run scripts/build.ts
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)
    echo "serving http://localhost:{{port}}/  ·  LAN (phone, same Wi-Fi): http://$ip:{{port}}/"
    python3 -m http.server --bind 0.0.0.0 -d dist {{port}}

# Run the test suite
test:
    bun test

# Type-check only (no emit)
typecheck:
    tsc --noEmit

# Everything CI runs before deploying: type-check, test, build
check: typecheck test build

# Remove build output
clean:
    rm -rf dist
