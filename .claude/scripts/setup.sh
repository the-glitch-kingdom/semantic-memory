#!/usr/bin/env bash
# setup.sh — Run this once after cloning to install plugins and dependencies.
#
# Usage:
#   bash .claude/scripts/setup.sh

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

step() { echo -e "\n${BLUE}==>${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# --- Prerequisites ---
step "Checking prerequisites"
command -v git  >/dev/null 2>&1 || err "git is required"
command -v node >/dev/null 2>&1 || err "node is required (>=20)"
command -v npm  >/dev/null 2>&1 || err "npm is required"
ok "Prerequisites met"

# --- npm dependencies (hit-em-with-the-docs) ---
step "Installing npm dependencies"
cd "$PROJECT_DIR"
npm install
ok "npm dependencies installed"

# --- persistent-planning ---
step "Installing persistent-planning"
# v2+ installs through the plugin marketplace; the old install.sh --scope flow was removed
if command -v claude >/dev/null 2>&1; then
    claude plugin marketplace add TheGlitchKing/persistent-planning >/dev/null 2>&1 || true
    claude plugin install persistent-planning@persistent-planning-marketplace \
        || err "persistent-planning plugin install failed"
    ok "persistent-planning installed (Claude Code plugin)"
else
    echo "  claude CLI not found; in Claude Code run:"
    echo "    /plugin marketplace add TheGlitchKing/persistent-planning"
    echo "    /plugin install persistent-planning@persistent-planning-marketplace"
fi

# --- babel-fish ---
step "Installing babel-fish"
git clone --depth=1 --quiet \
    https://github.com/TheGlitchKing/babel-fish.git \
    "$TMP_DIR/babel-fish"
bash "$TMP_DIR/babel-fish/.claude/install.sh" "$PROJECT_DIR"
ok "babel-fish installed"

# --- Done ---
echo ""
echo -e "${GREEN}=============================${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo -e "${GREEN}=============================${NC}"
echo ""
echo "Installed plugins:"
echo "  • persistent-planning  → Claude Code plugin (/start-planning, /plan-status, …)"
echo "  • babel-fish           → .claude/skills/, .claude/rules/, .claude/templates/"
echo "  • hit-em-with-the-docs → node_modules/ (CLI: hewtd)"
echo ""
echo "Open this project in Claude Code to get started."
