# Fork release + local install

Fork-only pipeline. One versioned, checksummed, attested artifact of the Dashboard global package. Never `npm publish`. Never deploys. Install on Spinx = separate, explicitly approved step.

See change: fork-release-and-local-install.

## Pieces

| Path | Role |
|---|---|
| `.github/workflows/spinx-release.yml` | Build + smoke + (tag only) GitHub prerelease |
| `scripts/spinx-release/layout-manifest.json` | Required files, overlay packages, forbidden names |
| `scripts/spinx-release/build-release-tree.mjs` | Assemble tree from `npm pack` output in temp copy |
| `scripts/spinx-release/make-artifact.mjs` | Deterministic tar.gz + `SHA256SUMS` + `manifest.json` + secrets scan |
| `scripts/spinx-release/install-release.sh` | Verify, stage, atomic swap, health, auto-rollback |
| `scripts/spinx-release/rollback-release.sh` | Restore last install record |
| `scripts/spinx-release/verify-install.sh` | Read-only post-install checks |
| `scripts/spinx-release/probe-leaf-helper.sh` | Isolated WO-A probe (+ `probe-ext.ts`) |
| `scripts/spinx-release/lib.sh` | Shared env defaults + helpers |

## Version

- `<base>-spinx.<N>`, e.g. `0.10.0-spinx.1`. Prerelease: cannot satisfy upstream `^0.10.0`.
- Stamped only in temp copy: root + `packages/*/package.json`, then `scripts/sync-versions.js`. Source tree untouched.
- Package names unchanged. Settings paths + imports depend on them.
- Tags `spinx-v<version>`. Upstream `publish.yml` fires on `v*` only: no collision.

## Cut a release

1. Merge to fork `develop`.
2. Annotated tag (enforced: workflow fails on lightweight tags or a tag not at the built commit) on a `develop` commit: `git tag -a spinx-v0.10.0-spinx.1 -m ...`; `git push <fork-remote> spinx-v0.10.0-spinx.1`. No force. Never move a tag.
3. Workflow: validate version, tag reachable from `develop`, `pnpm install --frozen-lockfile`, `pnpm run build`, focused tests, build tree, pack, smoke (install into throwaway prefix + probe), upload, release job.
4. Dry-run: `workflow_dispatch` with `dry-run=true` (default). Build + smoke only. Artifact kept 14 days.
5. Release job needs tag push, or dispatch with `dry-run=false` and an existing tag. Uploads tarball, `SHA256SUMS`, `manifest.json`. Creates provenance attestation. GitHub prerelease.

## Artifact layout

- File: `spinx-pi-dashboard-<ver>-linux-x64-node24.tar.gz`. Top dir `pi-agent-dashboard/`.
- Contents: root package tarball (`package.json`, bin, `packages/server`, `shared`, `extension`, `dist`). Overlay of real-file copies: `packages/extension`, `automation-plugin`, `flows-plugin`, `goal-plugin`, `gmail-plugin`, `flows-anthropic-bridge-plugin`. Production `node_modules` installed from local tarballs of all public workspaces (`file:` + `overrides`: registry never serves an `@blackbelt-technology` name).
- Deterministic: sorted entries, mtime 0, owner 0, `gzip -n`. Two independent tree builds gave identical sha256.
- Symlinks: only under `node_modules/.bin`, relative, inside tree.
- Secrets scan fails the pack. Names everywhere (incl. `node_modules`): `auth.json`, `.env`, `.credentials.json`, `.npmrc`, `id_rsa`, `id_ed25519`. Tokens everywhere (<= 50 MB files): `ghp_`-family, `sk-ant-`. Outside `node_modules` also private-key headers + `AKIA`.
- Client required: `node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` (built `packages/client/dist`, git-ignored, copied by the builder).
- CI reproducibility gate: second independent build must hash identically (same registry state; deps are not lock-pinned).
- npm >= 11.18 skips dependency install scripts unless approved. Builder writes `allowScripts`: esbuild, koffi, node-pty, ffmpeg-static, @ffprobe-installer/linux-x64, protobufjs, pi-dashboard-server, pi-dashboard-forms-bpmn.

## Install on Spinx (needs Nathan's explicit approval; never from CI)

```bash
gh release download spinx-v<ver> --repo njhughes-01/pi-agent-dashboard -D /tmp/spx-rel
cd <fork checkout at the tagged commit>
SPINX_VERIFY_ATTESTATION=1 SPINX_ATTEST_REPO=njhughes-01/pi-agent-dashboard \
  bash scripts/spinx-release/install-release.sh --artifact /tmp/spx-rel/<tarball> \
  --sums /tmp/spx-rel/SHA256SUMS --manifest /tmp/spx-rel/manifest.json   # add --dry-run first
bash scripts/spinx-release/verify-install.sh --version <ver>
bash scripts/spinx-release/probe-leaf-helper.sh
```

- `G=~/.local/lib/node_modules/@blackbelt-technology`.
- Order: sha256 of tarball + manifest, platform `linux-x64`, node major 24 -> extract to `$G/.pi-agent-dashboard.next-<ver>` -> required files + version -> tar backup in `~/.local/share/spinx-release/backups` (+ `.sha256`) -> stop `pi-dashboard.service` only -> rename current to `$G/.pi-agent-dashboard.rollback-<old>-<ts>` -> rename next to `$G/pi-agent-dashboard` -> start -> poll health up to 60 s.
- Failure or interruption (INT/TERM/HUP) after the service stopped: old dir restored, unit restarted, exit non-zero. Install record written atomically while recovery is still armed.
- One install/rollback at a time: `flock` on `<backup dir>/.lock`.
- Writes only `$G` and backup dir. Never touches auth, `settings.json`, `config.json`, unit file, `~/.local/bin/pi-dashboard` symlink.
- Env overrides (tests): `SPINX_GLOBAL_DIR`, `SPINX_BACKUP_DIR`, `SPINX_SYSTEMCTL`, `SPINX_HEALTH_URL`, `SPINX_HEALTH_TIMEOUT`, `SPINX_UNIT`.

## Verify + probe

- `verify-install.sh`: required files as regular files, version, health JSON object, client HTML at `/`, every `settings.json` path under `$G` exists. Read-only.
- `probe-leaf-helper.sh`: second instance of installed package on ports 18700/18701, temp HOME, scripted faux model. No credentials. Live service untouched.
  - REST spawn with `excludeTools`: keeper log shows `--exclude-tools Agent,agent_*,workflow_*`.
  - Baseline run: all five tools run. Excluded run: `Agent`, `agent_probe`, `workflow_probe` rejected; `probe_ok`, `read` work.
  - Unsets inherited `PI_DASHBOARD_*` / `PI_CODING_AGENT_*` so only the throwaway HOME is used. Checks client HTML at `/`.
  - Stops its own processes. Leaves small scratch dir under `/tmp` (`spinx-probe.*`).

## Rollback

- `bash scripts/spinx-release/rollback-release.sh`.
- Checks recorded rollback dir hash = pre-install tree hash. Swaps back, restarts, polls health. Transactional: failure before completion keeps the active install; same lock as install.
- Replaced install kept as `$G/.pi-agent-dashboard.rolled-back-*`. Old rollback/failed dirs accumulate: delete by hand after checking.
- First rollback dir = original npmGlobal 0.9.0 install.
- Second route: tar backup in backup dir.

## Tests

- `scripts/__tests__/spinx-release-{layout,tree,artifact,install,verify}.test.mjs`.
- Temp prefixes + fake `systemctl` + throwaway health server. Live install never read or written.

## Upstream sync

- `origin` = `BlackBeltTechnology/pi-agent-dashboard`. Fork changes are additive new files.
- Sync: merge `origin/develop` into a branch off fork `develop`, PR on fork.
