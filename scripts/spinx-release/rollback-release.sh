#!/usr/bin/env bash
# Restore the install recorded by the last install-release.sh run.
#
#   rollback-release.sh [--no-restart]
#
# Swaps the recorded rollback directory back into place and verifies the
# restored tree hash equals the one recorded before the install. The swap is a
# transaction: if it fails (or is interrupted) before it completes, the
# currently active install is put back and the service restarted.
# See change: fork-release-and-local-install.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
RESTART=1
if [ "${1:-}" = "--no-restart" ]; then RESTART=0; fi

acquire_lock
STATE="$SPINX_BACKUP_DIR/last-install.json"
[ -f "$STATE" ] || die "no install record at $STATE"
st() { node -p "require('$STATE')['$1']"; }
ROLLBACK="$(st rollbackDir)"; WANT="$(st treeHashBefore)"; OLDVER="$(st oldVersion)"; NEWVER="$(st newVersion)"; BACKUP="$(st backup)"
CUR="$SPINX_GLOBAL_DIR/$PKG_NAME"
[ -d "$ROLLBACK" ] || die "rollback directory is gone: $ROLLBACK (restore from $BACKUP)"
[ "$(tree_hash "$ROLLBACK")" = "$WANT" ] || die "rollback directory hash differs from the recorded pre-install hash"

REPLACED="$SPINX_GLOBAL_DIR/.$PKG_NAME.rolled-back-$NEWVER-$(date -u +%Y%m%dT%H%M%SZ)-$$"
STOPPED=0 MOVED_CUR=0 COMMITTED=0
undo() {
  local rc=$?
  trap - EXIT ERR
  if [ "$COMMITTED" = 0 ]; then
    log "FAILED (rc=$rc): keeping the active install"
    if [ "$MOVED_CUR" = 1 ]; then
      if [ -d "$CUR" ]; then mv "$CUR" "$ROLLBACK"; fi
      mv "$REPLACED" "$CUR"
    fi
    if [ "$STOPPED" = 1 ]; then unit start || true; fi
  fi
  exit "$rc"
}
trap undo EXIT ERR
trap 'exit 130' INT TERM HUP

if [ "$RESTART" = 1 ]; then unit stop; STOPPED=1; fi
mv "$CUR" "$REPLACED"; MOVED_CUR=1
mv "$ROLLBACK" "$CUR"; COMMITTED=1
trap - EXIT ERR
if [ "$RESTART" = 1 ]; then
  unit start
  wait_healthy || die "restored $OLDVER but the health check failed"
fi
[ "$(tree_hash "$CUR")" = "$WANT" ] || die "restored tree hash mismatch"
rm -f "$STATE"
log "rolled back to $OLDVER; the replaced install is at $REPLACED"
