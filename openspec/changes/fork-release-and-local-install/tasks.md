# Tasks — fork-release-and-local-install

- [x] 1 Layout manifest + test (`scripts/spinx-release/layout-manifest.json`, `scripts/__tests__/spinx-release-layout.test.mjs`) -> verify: test lists bin, packages/extension and 5 plugin bridge paths.
- [x] 2 Tree builder (`scripts/spinx-release/build-release-tree.mjs`, `scripts/__tests__/spinx-release-tree.test.mjs`) -> verify: stamps temp copy only; tree matches manifest; no symlinks.
- [x] 3 Artifact packer (`scripts/spinx-release/make-artifact.mjs`, `scripts/__tests__/spinx-release-artifact.test.mjs`) -> verify: two builds equal hash; planted secret file fails.
- [x] 4 Workflow (`.github/workflows/spinx-release.yml`) -> verify: actionlint/YAML checks; no publish/deploy steps.
- [x] 5 Installer (`scripts/spinx-release/install-release.sh`, `scripts/__tests__/spinx-release-install.test.mjs`) -> verify: success, checksum mismatch, health-fail rollback, mid-swap failure on a temp prefix.
- [x] 6 Rollback (`scripts/spinx-release/rollback-release.sh`, `scripts/__tests__/spinx-release-rollback.test.mjs`) -> verify: hash-identical round trip.
- [x] 7 Verify + probe (`scripts/spinx-release/verify-install.sh`, `scripts/spinx-release/probe-leaf-helper.sh`) -> verify: runs against a temp-prefix install.
- [x] 8 Docs (`docs/fork-release.md`) -> verify: `node scripts/check-conventions.mjs --base origin/develop`-style check passes.
