# Tasks — sync-upstream-0-11-0

- [x] 1 Refs verified before coding: `fork/develop` = `7d6504f0b`, tag `v0.11.0` = `6bdb9184472a41eb8ab5a7cdfda101c3cd531787`, merge-base = `db03c6b91`; no fetches -> verify: `git rev-parse` + `git merge-base` output matches, logged under `.hq-scratch/`.
- [ ] 2 Topic branch `feat/sync-upstream-0-11-0` from `fork/develop`; this change committed on it -> verify: `git merge-base fork/develop HEAD` = `7d6504f0b`.
- [ ] 3 Merge the exact tag: `git merge v0.11.0` (no conflicts expected; if any, stop and report) -> verify: merge commit parents = fork tip + tag commit; `git diff ecb35b999` empty (tree equals the reference clean merge).
- [ ] 4 Invariant source markers present post-merge (5 invariants) -> verify: `git grep` finds `excludeTools` + `name` spawn handling, `steer|followUp` prompt mode, ACP 400 rejection, `apiMiss`/`mcpMiss`/`isNavigation` in `replyIfApiNotFound`, `scripts/spinx-release/` files and `spinx-release.yml`.
- [ ] 5 Version + lockfile alignment: root and every `packages/*/package.json` = `0.11.0`; `pnpm-lock.yaml` importers at `0.11.0`; no `-spinx` stamp in source -> verify: grep counts + `pnpm install --frozen-lockfile` clean.
- [ ] 6 Upstream OpenSpec artifacts preserved -> verify: merge diff vs tag keeps `openspec/specs/*` from upstream (`git diff v0.11.0 -- openspec/specs` shows only fork-local additions); upstream change dirs from v0.11.0 present.
- [ ] 7 Targeted fork tests green post-merge -> verify: vitest on `session-api-prompt-mode`, `session-api-spawn-capability-scope`, `spa-fallback`, `spawn-mechanism`, and all `scripts/__tests__/spinx-release-*.test.mjs` (non-publishing, temp-prefix only), log under `.hq-scratch/`.
- [ ] 8 OpenSpec validate -> verify: `openspec validate sync-upstream-0-11-0 --strict` passes; `node scripts/check-conventions.mjs --base fork/develop` no new violations.
- [ ] 9 Full test suite -> verify: `npm test` (vitest, pipefail + tee to `.hq-scratch/test.log`); failures triaged against upstream's own v0.11.0 baseline before touching anything.
- [ ] 10 Independent code review of the merge (Pi on `openai/gpt-6.1-sol`, read-only) against this change -> verify: reviewer confirms parents, invariants, versions, no publish/install/restart steps; result logged under `.hq-scratch/`.
- [ ] 11 No-merge/no-release attestation -> verify: final report states: PR not merged, no tags created, nothing installed/restarted, `fork/develop` still at `7d6504f0b`.
