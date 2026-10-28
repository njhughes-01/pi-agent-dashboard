# Design — sync-upstream-0-11-0

## D1 Merge, not replace

`git merge v0.11.0` (annotated tag `6bdb91844`) on a topic branch cut from `fork/develop` (`7d6504f0b`). Common base `db03c6b91`. Two parents keep every fork commit (PRs #1–#5) and every upstream commit reachable; `git log --graph` shows both lanes.

## D2 Overlap surface

Fork touched 27 files since base; upstream touched ~188. Overlap by path: `packages/server/src/server.ts` and `docs/AGENTS.md`. The fork's `replyIfApiNotFound` block and upstream's server.ts changes are in different regions; the pre-existing trial merge `ecb35b999` (same two parents) recorded an empty combined diff, i.e. git auto-merged with zero conflict resolutions. Our MERGE commit's tree must equal `ecb35b999`'s apart from this change's own OpenSpec folder (`git diff ecb35b999 eabb54191 -- . ':(exclude)openspec/changes/sync-upstream-0-11-0'` empty) — any other deviation is a red flag to stop and report.

## D3 Invariant preservation = merge correctness

The five invariants (proposal) are each asserted by a test that only exists in the fork: `session-api-spawn-capability-scope.test.ts`, `session-api-prompt-mode.test.ts`, `spawn-mechanism.test.ts`, `spa-fallback.test.ts`, `scripts/__tests__/spinx-release-*.test.mjs`. Green after the merge = preserved. `git grep` markers confirm at source level too.

## D4 Version alignment

Upstream's release commit `2a67deff9` bumps all `packages/*/package.json` to `0.11.0`; the fork never edited versions, so the merge adopts `0.11.0` cleanly (root, all packages, `pnpm-lock.yaml` importers). Source stays plain `0.11.0` — the `-spinx.N` stamp happens only inside `scripts/spinx-release/build-release-tree.mjs` on a CI copy (`docs/fork-release.md` convention `0.11.0-spinx.1` / tag `spinx-v0.11.0-spinx.1` for the future release; not exercised here — release-tree tests run against temp prefixes and never publish).

## D5 Reference-merge cross-check

`ecb35b999` (on `feat/sync-upstream-v0.11.0`, a separate worktree we do not touch) is treated as a read-only oracle: same parents, clean merge. Our merge commit `eabb54191`'s tree equals its tree, apart from this change's own `openspec/changes/sync-upstream-0-11-0/` folder (verified with an `:(exclude)` pathspec diff — empty). Follow-on commits on the branch (OpenSpec updates + one allowlist entry) are verified separately via `git diff eabb54191 HEAD --stat`.
