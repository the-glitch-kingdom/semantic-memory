#!/usr/bin/env bash
#
# Fresh-install smoke test (v1.2).
#
# Packs the package into a tarball, installs it into a throwaway consumer
# project, and asserts the things that broke in the v1.1.0 packaging bug:
#   1. `bin --version` reports the CURRENT version (not a stale cached one)
#   2. the CLI loads all commands (catches ERR_MODULE_NOT_FOUND / broken dist)
#   3. every file the runtime depends on is actually IN the tarball
#   4. the SessionStart reconcile wiring populates .mcp.json on a fresh install
#      (the exact class of regression the v1.1.1 hotfix chased)
#
# Runs in CI before publish and is runnable locally: `bash scripts/smoke-install.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

echo "==> building"
npm run build >/dev/null

echo "==> packing tarball"
TARBALL="$(npm pack --silent)"
TARBALL_ABS="$ROOT/$TARBALL"
EXPECTED_VERSION="$(node -p "require('$ROOT/package.json').version")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$TARBALL_ABS"' EXIT

cd "$WORK"
cat > package.json <<'JSON'
{ "name": "smoke-consumer", "version": "1.0.0", "private": true }
JSON

echo "==> installing tarball into clean project ($WORK)"
npm install --no-audit --no-fund "$TARBALL_ABS" >/dev/null 2>&1 \
  || fail "npm install of the tarball failed (postinstall error?)"

PKG="$WORK/node_modules/@theglitchking/semantic-memory"
BIN="$PKG/bin/semantic-memory"

# 1. version
[ -f "$BIN" ] || fail "bin not found at $BIN"
GOT="$(node "$BIN" --version | tr -d '[:space:]')"
[ "$GOT" = "$EXPECTED_VERSION" ] || fail "version mismatch: bin=$GOT expected=$EXPECTED_VERSION"
echo "  ok: --version = $GOT"

# 2. CLI loads (all subcommands wired, dist resolvable)
node "$BIN" --help >/dev/null 2>&1 || fail "--help failed to run (broken dist / module resolution)"
node "$BIN" tools >/dev/null 2>&1 || fail "'tools' subcommand failed to run"
echo "  ok: CLI loads (--help, tools)"

# 3. runtime files present in the tarball
for f in \
  dist/cli/index.js \
  dist/mcp/server.js \
  hooks/hooks.json \
  hooks/vault-context.js \
  hooks/reconcile.js \
  hooks/session-start.js \
  commands/mode.md \
  skills/vault-first/SKILL.md \
  skills/research-mode/SKILL.md \
  skills/outage-silence/SKILL.md
do
  [ -e "$PKG/$f" ] || fail "missing shipped file: $f"
done
echo "  ok: shipped runtime files present"

# 4. reconcile wiring populates .mcp.json on a fresh install
node --input-type=module -e "
import { reconcile } from '$PKG/hooks/reconcile.js';
reconcile(process.cwd());
" || fail "reconcile() threw"
node -e "
const d = require('$WORK/.mcp.json');
const k = Object.keys((d && d.mcpServers) || {});
if (!k.includes('semantic-memory')) { console.error('no semantic-memory entry; got: ' + k.join(',')); process.exit(1); }
if (k.some((n) => n === 'semantic-vault' || n === 'semantic-sidekick')) { console.error('legacy-named duplicate; got: ' + k.join(',')); process.exit(1); }
" || fail "reconcile did not populate .mcp.json with a semantic-memory entry (and no legacy-named one)"
echo "  ok: reconcile populated .mcp.json (semantic-memory)"

echo "SMOKE PASS (v$EXPECTED_VERSION)"
