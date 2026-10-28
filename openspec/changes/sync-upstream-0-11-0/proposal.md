# Sync upstream v0.11.0 into the Spinx fork

## Why

The Spinx fork (`fork/develop`, 0.10.0 + WO-A/fork-release fixes) has drifted from upstream `pi-agent-dashboard`. Upstream released `v0.11.0` (tag `6bdb9184472a41eb8ab5a7cdfda101c3cd531787`, 34 commits since the common base `db03c6b91`). Staying behind costs us upstream fixes (port-conflict surfacing #977, gateway bind #978, process-group kill #912, team-plugin symlink guard #971, credential/TLS work #1064) and makes every future fork fix harder to rebase. A plain replace or cherry-pick would drop fork commits; only a merge keeps both histories auditable.

## What Changes

- A `git merge` of the exact upstream tag `v0.11.0` into the fork branch (no squash, no cherry-pick, no replace).
- The merge preserves five fork invariants (the WO-A + fork hardening work):
  1. `POST /api/session/spawn` accepts `excludeTools` + `name` (`session-api.ts`).
  2. `POST /api/session/:id/prompt` accepts `mode: "steer" | "followUp"`.
  3. `excludeTools`/`name` on an ACP agent spawn is rejected with HTTP 400.
  4. SPA fallback hardening: unmatched `/api`, non-navigation requests and `/mcp` misses get JSON 404s, never the index shell (`server.ts` `replyIfApiNotFound`).
  5. Fork release/install tooling under `scripts/spinx-release/` + `.github/workflows/spinx-release.yml` + `docs/fork-release.md`.
- Upstream OpenSpec artifacts (`openspec/changes/*`, `openspec/specs/*`) arrive intact from the merge.
- Source versions become plain `0.11.0` (upstream's own bump `2a67deff9`); the artifact convention `<base>-spinx.<N>` / `spinx-v<base>-spinx.<N>` (e.g. `0.11.0-spinx.1`) is untouched and applied only in the CI copy, never in source.
- One follow-on allowlist entry (`ui-copy-allowlist.json`): the ACP-400 error string added on develop by `f54f5c70f` lacks its exact (file, text) exemption, so `ui-copy-no-spawn.test.ts` already fails on `fork/develop`; the entry (not the string) is added here so the copy lint is green. Verified pre-existing via byte-identical test/allowlist/source blobs.
- No production changes: nothing is merged to `develop`, tagged, published, installed, or restarted by this change.

## Discipline Skills

`doubt-driven-review` (independent review of the merge before it stands), `security-hardening` is not reworked here but the fork's secrets-scan release test must stay green. No performance work.

## Non-goals

Merging to `fork/develop`, tagging `spinx-v0.11.0-spinx.1`, publishing, installing on Spinx, restarting services, changing any upstream file, WO-B..WO-E.
