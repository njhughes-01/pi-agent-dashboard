# Design

## Decisions (locked)
1. **Version** `<base>-spinx.<N>` (prerelease: cannot satisfy upstream `^0.10.0`). Stamped with `npm pkg set` + `scripts/sync-versions.js` inside a temp copy; `git diff` of the source tree must stay empty. Package names unchanged. Never `npm publish`.
2. **Trigger** non-force annotated tag `spinx-v*`; `workflow_dispatch` with `dry-run` default true (build + smoke, no release). Upstream `publish.yml` (`v*`) untouched.
3. **Tree** (`pi-agent-dashboard/`): the root package tarball content (root package.json/bin, `packages/server`, `shared`, `extension`, `dist`), overlaid with real-file copies of the five configured plugin packages at `packages/<dir>` (automation-plugin, flows-plugin, goal-plugin, gmail-plugin, flows-anthropic-bridge-plugin), plus production `node_modules` installed from the local tarballs of every public workspace. No symlinks, no secrets.
4. **Artifact** `spinx-pi-dashboard-<ver>-linux-x64-node24.tar.gz` (deterministic: sorted entries, fixed mtime/owner, gzip -n), `SHA256SUMS`, `manifest.json` (source SHA, version, node ABI, platform, required paths, tree digest). Attested with `actions/attest-build-provenance`.
5. **Install** into `G=~/.local/lib/node_modules/@blackbelt-technology`: extract to `$G/.pi-agent-dashboard.next-<ver>`, validate everything there, tar backup (sha256 recorded) to `~/.local/share/spinx-release/backups/`, stop only `pi-dashboard.service`, `mv pi-agent-dashboard -> .pi-agent-dashboard.rollback-<oldver>-<ts>`, `mv next -> pi-agent-dashboard`, start, health. Failure at any step after the first rename swaps back automatically. The `~/.local/bin/pi-dashboard` symlink, auth, settings, config and unit file are never written.
6. **Testability** every script honours `SPINX_GLOBAL_DIR`, `SPINX_BACKUP_DIR`, `SPINX_SYSTEMCTL`, `SPINX_HEALTH_URL`, and `--dry-run`; tests use temp dirs and a fake systemctl.
7. **Probe** an isolated second instance of the installed package (ports 18700/18701, temp HOME, scripted faux provider) — the live service is only health-checked.

## Risks
Layout drift (guarded by `layout-manifest.json` + test); native-module ABI (manifest pins node24/linux-x64, install refuses mismatch); restart downtime of a few seconds (live deployment needs separate approval).
