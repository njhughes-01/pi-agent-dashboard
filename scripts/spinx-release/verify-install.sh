#!/usr/bin/env bash
# Read-only verification of an installed fork release.
#
#   verify-install.sh [--version <expected>]
#
# Checks: required layout files as regular files, package version, health JSON,
# client served at /, and that every settings.json package path under the
# global dir resolves. Reads (never writes) $SPINX_SETTINGS.
# See change: fork-release-and-local-install.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
SPINX_SETTINGS="${SPINX_SETTINGS:-$HOME/.pi/agent/settings.json}"
EXPECT=""
if [ "${1:-}" = "--version" ]; then EXPECT="${2:?--version needs a value}"; fi

PKG="$SPINX_GLOBAL_DIR/$PKG_NAME"
FAILS=0
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then log "PASS $label"; else log "FAIL $label"; FAILS=$((FAILS + 1)); fi
}

# Each node call runs on its own so a failure is a counted check, not an empty list.
REQUIRED="$(node -p "require('$HERE/layout-manifest.json').requiredFiles.join('\n')")" || { log "FAIL read layout manifest"; FAILS=$((FAILS + 1)); REQUIRED=""; }
while IFS= read -r f; do
  [ -n "$f" ] && check "required file $f" test -f "$PKG/$f" -a ! -L "$PKG/$f"
done <<< "$REQUIRED"

if [ -n "$EXPECT" ]; then check "version is $EXPECT" test "$(pkg_version "$PKG")" = "$EXPECT"; fi
is_json() { curl -fsS --max-time 5 "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j&&typeof j==="object"?0:1)}catch{process.exit(1)}})'; }
is_client_html() { curl -fsS --max-time 5 "$1" | grep -qi '<html'; }
check "health answers a JSON object" is_json "$SPINX_HEALTH_URL"
check "client HTML is served at /" is_client_html "${SPINX_HEALTH_URL%/api/health}/"

if [ -f "$SPINX_SETTINGS" ]; then
  PATHS="$(node -e '
const s = require(process.argv[1]);
const g = process.argv[2];
const all = [...(s.packages || []), ...Object.values(s.dashboardPluginBridges || {}), ...Object.keys(s._dashboardManagedPackages || {})];
for (const p of new Set(all)) if (typeof p === "string" && p.startsWith(g)) console.log(p);
' "$SPINX_SETTINGS" "$SPINX_GLOBAL_DIR")" || { log "FAIL read settings $SPINX_SETTINGS"; FAILS=$((FAILS + 1)); PATHS=""; }
  while IFS= read -r p; do
    [ -n "$p" ] && check "settings path $p" test -e "$p"
  done <<< "$PATHS"
fi

if [ "$FAILS" -ne 0 ]; then log "$FAILS check(s) failed"; exit 1; fi
log "all checks passed for $(pkg_version "$PKG")"
