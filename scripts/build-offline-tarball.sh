#!/usr/bin/env bash
#
# build-offline-tarball.sh
#
# Produce a self-contained .tgz of semantic-sidekick that an air-gapped
# operator can extract and install with no npm / no Hugging Face / no GitHub.
#
# Targets: RHEL 9, RHEL 10, Ubuntu 24.04 (x86_64). Diagnostic in
# .planning/offline-packaging/notes.md confirmed all native bindings require
# <= GLIBC_2.29, well below RHEL 9's 2.34 — so direct Ubuntu 24.04 build is safe.
#
# Idempotency:
#   - Output filename is content-deterministic (version + git-sha). Re-running
#     on a clean tree produces the same name; existing output is preserved
#     unless --force is passed.
#   - Staging dir is wiped at start (no bleed-through from prior partial builds).
#   - npm install skipped if package-lock.json sha matches stored marker.
#   - tsup build skipped if dist/ is newer than every file in src/.
#   - Model warming skipped if cached files are present.
#
# Drift detection:
#   - Refuses to build if git tree is dirty (override with --allow-dirty).
#   - MANIFEST.json with sha256 of every staged file is generated and
#     self-verified before tarring.
#
# Usage:
#   scripts/build-offline-tarball.sh [--force] [--allow-dirty] [--out DIR]
#                                    [--skip-model] [--skip-npm] [--skip-build]

set -euo pipefail

# Resolve repo root (script lives in scripts/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="${REPO_ROOT}/scripts/lib"

# shellcheck source=lib/version.sh
source "${LIB_DIR}/version.sh"

# Defaults
FORCE=0
ALLOW_DIRTY=0
SKIP_MODEL=0
SKIP_NPM=0
SKIP_BUILD=0
OUT_DIR="${HOME}/.semantic-sidekick/dist-offline"

# Colors (only if stdout is a tty)
if [[ -t 1 ]]; then
  C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_BLUE='\033[0;34m'; C_RESET='\033[0m'
else
  C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''; C_RESET=''
fi

log()  { printf "${C_BLUE}[build]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}[build]${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}[build]${C_RESET} %s\n" "$*"; }
err()  { printf "${C_RED}[build]${C_RESET} %s\n" "$*" >&2; }

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --force         Rebuild even if a tarball with the same name already exists
  --allow-dirty   Allow build to proceed with uncommitted git changes
  --out DIR       Output directory (default: ~/.semantic-sidekick/dist-offline)
  --skip-model    Skip model warming + copy (fast iteration on script changes)
  --skip-npm      Skip the npm install step (assume node_modules is current)
  --skip-build    Skip the tsup build step (assume dist/ is current)
  -h, --help      Show this message
EOF
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --skip-model) SKIP_MODEL=1; shift ;;
    --skip-npm) SKIP_NPM=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown arg: $1"; usage; exit 2 ;;
  esac
done

cd "${REPO_ROOT}"

# ----------------------------------------------------------------------------
# Pre-flight checks
# ----------------------------------------------------------------------------
log "Pre-flight checks"

command -v node >/dev/null || { err "node not found"; exit 1; }
command -v npm  >/dev/null || { err "npm not found"; exit 1; }
command -v tar  >/dev/null || { err "tar not found"; exit 1; }
command -v rsync >/dev/null || { err "rsync not found (apt install rsync)"; exit 1; }
command -v sha256sum >/dev/null || { err "sha256sum not found"; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  err "Node ${NODE_MAJOR} too old; require >=18 (current: $(node -v))"
  exit 1
fi

DIRTY="$(resolve_git_dirty "${REPO_ROOT}")"
if [[ "${DIRTY}" == "dirty" && "${ALLOW_DIRTY}" -eq 0 ]]; then
  err "Working tree is dirty. Commit your changes or pass --allow-dirty."
  err "Manifest's git-sha must mean something."
  git -C "${REPO_ROOT}" status --short
  exit 1
fi

VERSION="$(resolve_pkg_version "${REPO_ROOT}")"
GIT_SHA="$(resolve_git_sha "${REPO_ROOT}")"
ARCH="x64"
TARBALL_BASENAME="$(resolve_tarball_basename "${VERSION}" "${GIT_SHA}" "${ARCH}")"
TARBALL_PATH="${OUT_DIR}/${TARBALL_BASENAME}.tgz"

ok "Version: ${VERSION}"
ok "Git SHA: ${GIT_SHA}${DIRTY:+ ($DIRTY)}"
ok "Output:  ${TARBALL_PATH}"

mkdir -p "${OUT_DIR}"

if [[ -f "${TARBALL_PATH}" && "${FORCE}" -eq 0 ]]; then
  warn "Tarball already exists at ${TARBALL_PATH}"
  warn "Pass --force to rebuild, or delete the existing file."
  exit 0
fi

# ----------------------------------------------------------------------------
# npm install (if needed)
# ----------------------------------------------------------------------------
INSTALL_MARKER="${REPO_ROOT}/node_modules/.install-marker"
LOCK_SHA="$(sha256sum "${REPO_ROOT}/package-lock.json" | awk '{print $1}')"

if [[ "${SKIP_NPM}" -eq 1 ]]; then
  warn "Skipping npm install (--skip-npm)"
elif [[ -d "${REPO_ROOT}/node_modules" \
        && -f "${INSTALL_MARKER}" \
        && "$(cat "${INSTALL_MARKER}")" == "${LOCK_SHA}" ]]; then
  ok "npm install up to date (lockfile sha unchanged)"
else
  log "Running npm ci"
  npm ci --silent
  echo "${LOCK_SHA}" > "${INSTALL_MARKER}"
  ok "npm ci complete"
fi

# ----------------------------------------------------------------------------
# Build (if needed)
# ----------------------------------------------------------------------------
DIST_DIR="${REPO_ROOT}/dist"

if [[ "${SKIP_BUILD}" -eq 1 ]]; then
  warn "Skipping build (--skip-build)"
elif [[ ! -d "${DIST_DIR}" ]]; then
  log "Running npm run build (dist/ missing)"
  npm run build
  ok "Build complete"
else
  # Check if any src/ file is newer than the oldest dist/ file
  NEWEST_SRC="$(find "${REPO_ROOT}/src" -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1 || echo 0)"
  OLDEST_DIST="$(find "${DIST_DIR}" -type f -printf '%T@\n' 2>/dev/null | sort -n | head -1 || echo 0)"
  if (( $(echo "${NEWEST_SRC} > ${OLDEST_DIST}" | bc -l) )); then
    log "Running npm run build (src/ newer than dist/)"
    npm run build
    ok "Build complete"
  else
    ok "Build up to date"
  fi
fi

# ----------------------------------------------------------------------------
# Warm the model cache
# ----------------------------------------------------------------------------
MODEL_NAME="sentence-transformers/all-MiniLM-L6-v2"
MODEL_DIR_NAME="${MODEL_NAME//\//--}"
MODEL_CACHE_ROOT="${HOME}/.semantic-sidekick/models"
MODEL_CACHE_DIR="${MODEL_CACHE_ROOT}/${MODEL_DIR_NAME}"

if [[ "${SKIP_MODEL}" -eq 1 ]]; then
  warn "Skipping model warming (--skip-model)"
  if [[ ! -d "${MODEL_CACHE_DIR}" ]]; then
    err "--skip-model passed but model cache is empty at ${MODEL_CACHE_DIR}"
    err "Cannot stage tarball without the model. Re-run without --skip-model."
    exit 1
  fi
else
  log "Warming model cache (${MODEL_NAME})"
  # tsup splits into chunks; Embedder is re-exported from the package's
  # main entry (dist/core/index.js). Use that, not a specific source path.
  node -e "
    import('${REPO_ROOT}/dist/core/index.js').then(async (mod) => {
      const e = new mod.Embedder();
      await e.init();
      await e.embed('warmup');
      console.log('warmed: ' + e.getModel() + ' (' + e.getDimensions() + 'd)');
    }).catch(err => { console.error(err); process.exit(1); });
  "
  ok "Model cache warmed at ${MODEL_CACHE_DIR}"
fi

# ----------------------------------------------------------------------------
# Stage tarball contents
# ----------------------------------------------------------------------------
STAGE_ROOT="${OUT_DIR}/.stage-${TARBALL_BASENAME}"
log "Staging at ${STAGE_ROOT}"

# Always start clean (idempotent)
rm -rf "${STAGE_ROOT}"
mkdir -p "${STAGE_ROOT}/${TARBALL_BASENAME}/semantic-sidekick"
mkdir -p "${STAGE_ROOT}/${TARBALL_BASENAME}/models"
mkdir -p "${STAGE_ROOT}/${TARBALL_BASENAME}/lib"

PLUGIN_STAGE="${STAGE_ROOT}/${TARBALL_BASENAME}/semantic-sidekick"

# Plugin tree — mirrors the package.json `files` allowlist plus what's needed
# at runtime when not going through npm.
RSYNC_INCLUDES=(
  "bin/"
  "dist/"
  ".claude-plugin/"
  "hooks/"
  "commands/"
  "scripts/"
  "skills/"
  "node_modules/"
  "package.json"
  "package-lock.json"
  "README.md"
  "LICENSE"
)

# Things we never want in the tarball
RSYNC_EXCLUDES=(
  ".git/"
  ".github/"
  ".githooks/"
  ".documentation/"
  ".planning/"
  ".claude/"
  "test/"
  "src/"
  "tsconfig.json"
  "tsup.config.ts"
  "vitest.config.ts"
  ".mcp.json"
  ".gitignore"
  ".npmignore"
  "CHANGELOG.md"
  "SECURITY.md"
  "node_modules/.cache/"
  "node_modules/.install-marker"
  "**/*.log"
  "**/.DS_Store"
)

EXCLUDE_ARGS=()
for ex in "${RSYNC_EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=(--exclude="${ex}")
done

log "Copying plugin tree (rsync)"
for item in "${RSYNC_INCLUDES[@]}"; do
  # Strip trailing slash so rsync copies the directory itself, not its contents.
  local_src="${REPO_ROOT}/${item%/}"
  if [[ -e "${local_src}" ]]; then
    rsync -a "${EXCLUDE_ARGS[@]}" "${local_src}" "${PLUGIN_STAGE}/"
  fi
done

# Copy the model cache — mirror the entire ~/.semantic-sidekick/models/ tree.
# The embedder uses TWO subdirs: <owner>--<name>/ for the ONNX file (flat
# layout written by Embedder.downloadFile), and <owner>/<name>/ for the
# tokenizer artifacts (nested layout written by @huggingface/transformers).
# Mirroring the whole dir captures both without us having to track the layout.
log "Copying model cache"
if [[ ! -f "${MODEL_CACHE_DIR}/model.onnx" ]]; then
  err "Expected model file missing: ${MODEL_CACHE_DIR}/model.onnx"
  err "Re-run without --skip-model to warm the cache."
  exit 1
fi
rsync -a --exclude "*.tmp" "${MODEL_CACHE_ROOT}/" "${STAGE_ROOT}/${TARBALL_BASENAME}/models/"  # *.tmp: partial downloads killed mid-way

# Bundle the installer + helper libs at the tarball root
log "Bundling install-offline.sh and lib/"
cp "${REPO_ROOT}/scripts/install-offline.sh" "${STAGE_ROOT}/${TARBALL_BASENAME}/install-offline.sh"
chmod +x "${STAGE_ROOT}/${TARBALL_BASENAME}/install-offline.sh"
cp "${LIB_DIR}/version.sh"  "${STAGE_ROOT}/${TARBALL_BASENAME}/lib/version.sh"
cp "${LIB_DIR}/manifest.js" "${STAGE_ROOT}/${TARBALL_BASENAME}/lib/manifest.js"
chmod +x "${STAGE_ROOT}/${TARBALL_BASENAME}/lib/manifest.js"

# Drop a one-page README at the tarball root
cat > "${STAGE_ROOT}/${TARBALL_BASENAME}/README.OFFLINE.md" <<EOF
# semantic-sidekick — offline install

Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Version: ${VERSION}
Git SHA: ${GIT_SHA}
Arch: ${ARCH}

## Install

\`\`\`
./install-offline.sh
\`\`\`

The installer:
- Verifies tarball integrity against MANIFEST.json
- Atomic-swaps existing install to .previous/ (if any)
- Places the plugin at ~/.semantic-sidekick/plugin/
- Places the model cache at ~/.semantic-sidekick/models/
- Sets HF_HUB_OFFLINE=1 in ~/.bashrc

## Other commands

\`\`\`
./install-offline.sh --status     # show installed version + drift report
./install-offline.sh --verify     # exit non-zero if installed state drifted
./install-offline.sh --rollback   # restore .previous/
./install-offline.sh --force      # reinstall same version
\`\`\`

After install, restart Claude Code.
EOF

# ----------------------------------------------------------------------------
# Generate manifests — TWO of them:
#   1. Plugin sub-manifest: ${PLUGIN_STAGE}/MANIFEST.json — describes only the
#      plugin tree, with paths relative to the plugin root. Used post-install
#      to drift-check the deployed plugin against this exact build.
#   2. Tarball manifest: ${STAGE}/${BASENAME}/MANIFEST.json — describes the
#      whole tarball. Used by install-offline.sh to detect transport corruption
#      before any destructive op.
# ----------------------------------------------------------------------------
log "Generating plugin sub-manifest"
node "${LIB_DIR}/manifest.js" generate \
  "${PLUGIN_STAGE}" \
  "${PLUGIN_STAGE}/MANIFEST.json" \
  --meta "version=${VERSION}" \
  --meta "gitSha=${GIT_SHA}" \
  --meta "arch=${ARCH}" \
  --meta "scope=plugin"

log "Generating tarball manifest"
node "${LIB_DIR}/manifest.js" generate \
  "${STAGE_ROOT}/${TARBALL_BASENAME}" \
  "${STAGE_ROOT}/${TARBALL_BASENAME}/MANIFEST.json" \
  --meta "version=${VERSION}" \
  --meta "gitSha=${GIT_SHA}" \
  --meta "arch=${ARCH}" \
  --meta "scope=tarball"

# ----------------------------------------------------------------------------
# Self-verify the staging area
# ----------------------------------------------------------------------------
log "Self-verifying staging area"
if ! node "${LIB_DIR}/manifest.js" verify \
       "${STAGE_ROOT}/${TARBALL_BASENAME}" \
       "${STAGE_ROOT}/${TARBALL_BASENAME}/MANIFEST.json"; then
  err "Self-verify failed. The staging area drifted between manifest gen and verify."
  err "This usually means a file is being written concurrently. Aborting."
  exit 1
fi

# ----------------------------------------------------------------------------
# Tar it up
# ----------------------------------------------------------------------------
log "Creating tarball"
tar -czf "${TARBALL_PATH}" -C "${STAGE_ROOT}" "${TARBALL_BASENAME}"

# Cleanup staging
rm -rf "${STAGE_ROOT}"

# Final report
SIZE_HUMAN="$(du -h "${TARBALL_PATH}" | awk '{print $1}')"
SHA="$(sha256sum "${TARBALL_PATH}" | awk '{print $1}')"

echo ""
ok "Build complete"
echo "  Path:    ${TARBALL_PATH}"
echo "  Size:    ${SIZE_HUMAN}"
echo "  SHA-256: ${SHA}"
echo ""
echo "  Transport this file to the target. At the destination:"
echo "    tar -xzf $(basename "${TARBALL_PATH}")"
echo "    cd ${TARBALL_BASENAME}"
echo "    ./install-offline.sh"
