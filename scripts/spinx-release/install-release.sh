#!/usr/bin/env bash
# Install a reviewed fork release artifact into the global package location.
#
#   install-release.sh --artifact <tar.gz> --sums <SHA256SUMS> --manifest <manifest.json> [--dry-run] [--no-restart]
#
# Verify -> stage next to the live dir -> validate -> backup -> stop unit ->
# two same-filesystem renames -> start unit -> health -> state record. Any
# failure or interruption after the service was stopped restores the previous
# directory and restarts the service. Writes only $SPINX_GLOBAL_DIR and
# $SPINX_BACKUP_DIR; never auth, settings, config or the unit file.
# See change: fork-release-and-local-install.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

ARTIFACT="" SUMS="" MANIFEST="" DRY=0 RESTART=1
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --sums) SUMS="$2"; shift 2 ;;
    --manifest) MANIFEST="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -f "$ARTIFACT" ] && [ -f "$SUMS" ] && [ -f "$MANIFEST" ] || die "--artifact, --sums and --manifest must be existing files"
acquire_lock

mf() { node -p "String(require('$MANIFEST')['$1'])"; }
VERSION="$(mf version)"; TARBALL="$(mf tarball)"; NODE_MAJOR="$(mf nodeMajor)"; PLATFORM="$(mf platform)"
[ "$(basename "$ARTIFACT")" = "$TARBALL" ] || die "artifact name does not match manifest ($TARBALL)"

# 1. verify checksums (artifact and manifest) before touching anything
sum_for() { awk -v n="$1" '$2 == n { print $1 }' "$SUMS"; }
EXPECT_TAR="$(sum_for "$TARBALL")"; EXPECT_MF="$(sum_for manifest.json)"
[ -n "$EXPECT_TAR" ] && [ -n "$EXPECT_MF" ] || die "SHA256SUMS lacks the artifact or manifest"
[ "$(sha256sum "$ARTIFACT" | cut -d' ' -f1)" = "$EXPECT_TAR" ] || die "checksum mismatch for $TARBALL"
[ "$(sha256sum "$MANIFEST" | cut -d' ' -f1)" = "$EXPECT_MF" ] || die "checksum mismatch for manifest.json"
if [ "${SPINX_VERIFY_ATTESTATION:-0}" = 1 ]; then
  gh attestation verify "$ARTIFACT" --repo "${SPINX_ATTEST_REPO:?set SPINX_ATTEST_REPO}" >/dev/null || die "attestation verification failed"
fi

# 2. platform / node ABI
[ "$PLATFORM" = "linux-x64" ] || die "unsupported manifest platform $PLATFORM"
[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || die "this host is not linux-x64"
[ "$(node -p 'process.versions.node.split(".")[0]')" = "$NODE_MAJOR" ] || die "node major must be $NODE_MAJOR"

CUR="$SPINX_GLOBAL_DIR/$PKG_NAME"; NEXT="$SPINX_GLOBAL_DIR/.$PKG_NAME.next-$VERSION"
[ -d "$CUR" ] || die "no current install at $CUR"
[ ! -e "$NEXT" ] || die "$NEXT already exists (remove it after checking it is stale)"
OLDVER="$(pkg_version "$CUR")"; TS="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ROLLBACK="$SPINX_GLOBAL_DIR/.$PKG_NAME.rollback-$OLDVER-$TS"

# 3. stage + validate in the next dir (service untouched)
mkdir "$NEXT"
trap 'rm -rf "$NEXT"' EXIT
trap 'exit 130' INT TERM HUP
tar -xzf "$ARTIFACT" -C "$NEXT" --strip-components=1 --no-same-owner
while IFS= read -r f; do
  [ -f "$NEXT/$f" ] && [ ! -L "$NEXT/$f" ] || die "staged tree lacks required file $f"
done < <(node -p "require('$MANIFEST').requiredFiles.join('\n')")
[ "$(pkg_version "$NEXT")" = "$VERSION" ] || die "staged package version differs from manifest"
log "verified $TARBALL ($VERSION); current install is $OLDVER"
if [ "$DRY" = 1 ]; then
  log "dry-run: would back up, stop $SPINX_UNIT, rename $CUR -> $ROLLBACK, activate $NEXT"
  exit 0
fi

# 4. backup (second restore route) + pre-install tree hash
BACKUP="$SPINX_BACKUP_DIR/$PKG_NAME-$OLDVER-$TS.tar.gz"
tar -C "$SPINX_GLOBAL_DIR" -czf "$BACKUP" "$PKG_NAME"
( cd "$SPINX_BACKUP_DIR" && sha256sum "$(basename "$BACKUP")" > "$(basename "$BACKUP").sha256" )
TREE_BEFORE="$(tree_hash "$CUR")"

# 5. swap; after the service stopped any failure/interruption restores the old state
STOPPED=0 SWAPPED=0
restore() {
  local rc=$?
  trap - EXIT ERR
  log "FAILED (rc=$rc): restoring $OLDVER"
  if [ "$RESTART" = 1 ] && [ "$STOPPED" = 1 ]; then unit stop || true; fi
  if [ "$SWAPPED" = 1 ]; then
    if [ -d "$CUR" ]; then mv "$CUR" "$SPINX_GLOBAL_DIR/.$PKG_NAME.failed-$VERSION-$TS"; fi
    mv "$ROLLBACK" "$CUR"
  fi
  if [ "$RESTART" = 1 ] && [ "$STOPPED" = 1 ]; then unit start || true; fi
  rm -rf "$NEXT"
  exit "$rc"
}
trap restore EXIT ERR
if [ "$RESTART" = 1 ]; then unit stop; STOPPED=1; fi
mv "$CUR" "$ROLLBACK"; SWAPPED=1
if [ "${SPINX_TEST_FAIL_AFTER_FIRST_RENAME:-0}" = 1 ]; then die "simulated failure after first rename"; fi
mv "$NEXT" "$CUR"
if [ "$RESTART" = 1 ]; then
  unit start
  wait_healthy || die "health check failed within ${SPINX_HEALTH_TIMEOUT}s"
fi
# the record is written atomically while recovery is still armed
node -e '
const fs = require("fs");
const [file, oldVersion, newVersion, rollbackDir, backup, treeHashBefore, at] = process.argv.slice(1);
fs.writeFileSync(`${file}.tmp`, JSON.stringify({ oldVersion, newVersion, rollbackDir, backup, treeHashBefore, at }, null, 2) + "\n");
fs.renameSync(`${file}.tmp`, file);
' "$SPINX_BACKUP_DIR/last-install.json" "$OLDVER" "$VERSION" "$ROLLBACK" "$BACKUP" "$TREE_BEFORE" "$TS"
trap - EXIT ERR
log "installed $VERSION; previous $OLDVER kept at $ROLLBACK (backup $BACKUP)"
