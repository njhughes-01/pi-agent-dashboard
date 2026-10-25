# Fork release artifacts and local install

## Why

Spinx runs the Dashboard from an npm global install (`~/.local/lib/node_modules/@blackbelt-technology/pi-agent-dashboard`, 0.9.0). Our fork carries fixes (WO-A) that upstream's registry versions do not. The fork's root package is a thin shell whose server, shared and extension dependencies resolve to upstream's registry 0.10.0, so a plain `npm pack`/install would silently deliver upstream code without the fork's changes. Pi's `settings.json` also loads the bridge and five plugins from fixed `.../pi-agent-dashboard/packages/<dir>/...` paths that the 0.10.0 root package no longer ships.

## What Changes

- A fork-only GitHub Actions workflow (`spinx-release.yml`, tags `spinx-v*` plus a dry-run dispatch) builds ONE versioned, checksummed, attested release artifact of the whole installable tree, stamped `<base>-spinx.<N>` in a CI copy only (source never mutated, nothing published to npm).
- A deterministic tree builder and artifact packer (`scripts/spinx-release/`).
- Spinx-side scripts: `install-release.sh` (verify, stage, atomic directory swap, health, auto-rollback), `rollback-release.sh`, `verify-install.sh`, `probe-leaf-helper.sh`.
- Docs: `docs/fork-release.md`.
- Tests that run only against temp prefixes; the live install is never touched by tests or CI.

Non-goals: publishing to npm, deploying from CI, changing upstream source or `publish.yml`, WO-B..WO-E, touching auth/settings/config/unit files, live installation (separate approval).

## Discipline Skills

`security-hardening` (artifact integrity, secrets scan, no force push), `observability-instrumentation` (verify report), `doubt-driven-review` before the swap/rollback scripts stand. No performance work.
