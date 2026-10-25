# shellcheck shell=bash
# Shared helpers for the Spinx fork-release scripts (sourced, not executed).
# See change: fork-release-and-local-install.
SPINX_GLOBAL_DIR="${SPINX_GLOBAL_DIR:-$HOME/.local/lib/node_modules/@blackbelt-technology}"
SPINX_BACKUP_DIR="${SPINX_BACKUP_DIR:-$HOME/.local/share/spinx-release/backups}"
SPINX_SYSTEMCTL="${SPINX_SYSTEMCTL:-systemctl}"
SPINX_UNIT="${SPINX_UNIT:-pi-dashboard.service}"
SPINX_HEALTH_URL="${SPINX_HEALTH_URL:-http://127.0.0.1:8000/api/health}"
SPINX_HEALTH_TIMEOUT="${SPINX_HEALTH_TIMEOUT:-60}"
PKG_NAME="pi-agent-dashboard"

log() { printf '[spinx-release] %s\n' "$*"; }
die() { printf '[spinx-release] ERROR: %s\n' "$*" >&2; exit 1; }

unit() { "$SPINX_SYSTEMCTL" --user "$1" "$SPINX_UNIT"; }

pkg_version() { node -p "require('$1/package.json').version" 2>/dev/null || echo unknown; }

# Poll the health URL until it answers 200 with JSON, or the timeout expires.
wait_healthy() {
  local deadline=$((SECONDS + SPINX_HEALTH_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 3 "$SPINX_HEALTH_URL" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);process.exit(0)}catch{process.exit(1)}})'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# tree_hash <dir>: stable digest of paths + file contents + symlink targets.
tree_hash() {
  (cd "$1" && find . \( -type f -o -type l \) -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' f; do
    if [ -L "$f" ]; then printf 'L %s %s\n' "$f" "$(readlink "$f")"; else printf 'F %s %s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"; fi
  done | sha256sum | cut -d' ' -f1)
}

# acquire_lock: one install/rollback at a time (shared by both scripts).
acquire_lock() {
  mkdir -p "$SPINX_BACKUP_DIR"
  exec 9>"$SPINX_BACKUP_DIR/.lock"
  flock -n 9 || die "another install/rollback is running (lock: $SPINX_BACKUP_DIR/.lock)"
}
