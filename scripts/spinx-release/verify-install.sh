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

while IFS= read -r f; do
  check "required file $f" test -f "$PKG/$f" -a ! -L "$PKG/$f"
done < <(node -p "require('$HERE/layout-manifest.json').requiredFiles.join('\n')")

if [ -n "$EXPECT" ]; then check "version is $EXPECT" test "$(pkg_version "$PKG")" = "$EXPECT"; fi
check "health answers JSON" curl -fsS --max-time 5 "$SPINX_HEALTH_URL"
check "client is served" curl -fsS --max-time 5 -o /dev/null "${SPINX_HEALTH_URL%/api/health}/"

if [ -f "$SPINX_SETTINGS" ]; then
  while IFS= read -r p; do
    check "settings path $p" test -e "$p"
  done < <(node -e '
const s = require(process.argv[1]);
const g = process.argv[2];
const all = [...(s.packages || []), ...Object.values(s.dashboardPluginBridges || {}), ...Object.keys(s._dashboardManagedPackages || {})];
for (const p of new Set(all)) if (typeof p === "string" && p.startsWith(g)) console.log(p);
' "$SPINX_SETTINGS" "$SPINX_GLOBAL_DIR")
fi

if [ "$FAILS" -ne 0 ]; then log "$FAILS check(s) failed"; exit 1; fi
log "all checks passed for $(pkg_version "$PKG")"
