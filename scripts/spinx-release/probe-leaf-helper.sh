#!/usr/bin/env bash
# Isolated leaf-helper (WO-A) probe against an INSTALLED package. Credential-free.
#
#   probe-leaf-helper.sh [--port 18700]
#
# Starts a second, ephemeral instance of $SPINX_GLOBAL_DIR/pi-agent-dashboard on
# ports P/P+1 with a throwaway HOME, spawns one child through the public REST
# path with excludeTools, then proves: (1) the exact argv
# `--exclude-tools Agent,agent_*,workflow_*` reached pi, (2) the excluded tool
# families are rejected while an allowed tool and the read-only built-in `read`
# work (scripted faux model, with a baseline run without the flag). Stops only
# the processes it started. The live service and the real HOME are never used.
# See change: fork-release-and-local-install.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# Agent-directory/port overrides inherited from the caller would defeat the throwaway HOME.
for v in $(env | cut -d= -f1 | grep -E '^(PI_DASHBOARD_|PI_CODING_AGENT_)' || true); do unset "$v"; done
PORT=18700
if [ "${1:-}" = "--port" ]; then PORT="${2:?--port needs a value}"; fi
PKG="$SPINX_GLOBAL_DIR/$PKG_NAME"
[ -d "$PKG" ] || die "no install at $PKG"
EXCLUDE="Agent,agent_*,workflow_*"
SCRATCH="$(mktemp -d -t spinx-probe.XXXXXX)"
H="$SCRATCH/home"; WORK="$SCRATCH/work"
mkdir "$H" "$WORK"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  sleep 1
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null; done
  log "scratch dir kept for inspection (small, under the temp dir): $SCRATCH"
}
trap cleanup EXIT
FAILS=0
check() { if [ "$1" = ok ]; then log "PASS $2"; else log "FAIL $2"; FAILS=$((FAILS + 1)); fi; }

NL="file://$PKG/packages/shared/src/platform/native-ts-register.mjs"
CLI=(node --import "$NL" "$PKG/packages/server/src/cli.ts")
HOME="$H" "${CLI[@]}" --port "$PORT" --pi-port "$((PORT + 1))" --no-tunnel >"$WORK/server.log" 2>&1 &
PIDS+=("$!")
SPINX_HEALTH_URL="http://127.0.0.1:$PORT/api/health" SPINX_HEALTH_TIMEOUT=90 wait_healthy || { tail -5 "$WORK/server.log" >&2; die "ephemeral instance did not become healthy"; }

if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/" | grep -qi '<html'; then check ok "client HTML is served at /"; else check fail "client HTML is not served at /"; fi

BODY="{\"cwd\":\"$WORK\",\"excludeTools\":[\"Agent\",\"agent_*\",\"workflow_*\"],\"name\":\"leaf-probe\"}"
RESP="$(HOME="$H" "${CLI[@]}" api POST /api/session/spawn --port "$PORT" --data "$BODY" 2>&1)"
KPID="$(printf '%s' "$RESP" | sed -n 's/.*keeper pid \([0-9]*\).*/\1/p')"
PIDS+=("$KPID")
for _ in $(seq 1 30); do
  if grep -qs -- "--exclude-tools $EXCLUDE" "$H"/.pi/dashboard/sessions/keeper-*.log 2>/dev/null; then break; fi
  sleep 1
done
KLOG="$(grep -hs "spawning pi" "$H"/.pi/dashboard/sessions/keeper-*.log 2>/dev/null | tail -1)"
for c in $(pgrep -P "${KPID:-0}" 2>/dev/null); do PIDS+=("$c"); done
case "$KLOG" in *"--exclude-tools $EXCLUDE"*) check ok "REST spawn passes exact argv: --exclude-tools $EXCLUDE" ;; *) check fail "REST spawn did not pass --exclude-tools $EXCLUDE (keeper log: ${KLOG:-none})" ;; esac

PICLI="$PKG/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
run_pi() { # run_pi <extra pi args...> -> prints "<tool>=<OK|ERROR>" lines
  (cd "$PKG" && HOME="$H" timeout 120 node "$PICLI" -e "$HERE/probe-ext.ts" --model faux/faux-1 --no-extensions "$@" --mode json -p go 2>/dev/null) | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  for (const l of s.split("\n")) { let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === "tool_execution_end") console.log(`${j.toolName}=${j.isError ? "ERROR" : "OK"}`); }
});'
}
BASE="$(run_pi)"
EXCL="$(run_pi --exclude-tools "$EXCLUDE")"
for t in Agent agent_probe workflow_probe probe_ok read; do
  case "$BASE" in *"$t=OK"*) check ok "baseline: $t runs without the flag" ;; *) check fail "baseline: $t did not run" ;; esac
done
for t in Agent agent_probe workflow_probe; do
  case "$EXCL" in *"$t=ERROR"*) check ok "excluded: $t is rejected" ;; *) check fail "excluded: $t was not rejected" ;; esac
done
for t in probe_ok read; do
  case "$EXCL" in *"$t=OK"*) check ok "excluded run: allowed tool $t works" ;; *) check fail "excluded run: $t failed" ;; esac
done

if [ "$FAILS" -ne 0 ]; then log "$FAILS probe check(s) failed"; exit 1; fi
log "leaf-helper probe passed"
