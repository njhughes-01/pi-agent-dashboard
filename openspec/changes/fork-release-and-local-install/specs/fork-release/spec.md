# fork-release — delta

## ADDED Requirements

### Requirement: CI builds a checksummed artifact without publishing
The fork workflow SHALL build one versioned tarball with `SHA256SUMS`, `manifest.json` and a provenance attestation, and SHALL NOT run `npm publish` or deploy.

#### Scenario: Dry-run
- **WHEN** the workflow is dispatched with dry-run
- **THEN** it builds and smoke-tests the artifact and creates no release

### Requirement: Artifact contains the settings-referenced paths as real files
The tree SHALL contain `packages/extension` and the five configured plugin `src/bridge/index.ts` files as regular files, and no symlinks anywhere.

#### Scenario: Missing path
- **WHEN** a required path is absent
- **THEN** the layout test and the installer validation SHALL fail

### Requirement: Source tree is not mutated
Version stamping SHALL happen only in a temporary copy.

#### Scenario: Build leaves source clean
- **WHEN** the tree builder runs
- **THEN** `git status` of the source tree SHALL be unchanged

### Requirement: Artifact is reproducible and secret-free
Two builds from one input SHALL yield identical tarball hashes, and the packer SHALL fail on credential-shaped files.

#### Scenario: Reproducible hash
- **WHEN** two independent builds run from the same commit
- **THEN** their tarball sha256 SHALL be identical

#### Scenario: Planted credential
- **WHEN** a credential file or token is present in the tree
- **THEN** the packer SHALL exit non-zero and write nothing

### Requirement: Installer verifies before acting
The installer SHALL refuse on checksum mismatch, wrong platform/node ABI, or missing required paths, before stopping the service.

#### Scenario: Checksum mismatch
- **WHEN** the tarball differs from SHA256SUMS
- **THEN** the installer SHALL exit non-zero without calling systemctl or changing the install

### Requirement: Atomic activation with rollback
Activation SHALL be two same-filesystem renames; any failure after the first rename, or a failed health check, SHALL restore the previous directory byte-for-byte.

#### Scenario: Round trip
- **WHEN** install is followed by rollback
- **THEN** the restored tree hash SHALL equal the pre-install tree hash

### Requirement: Scripts never touch auth, settings or config
Install and rollback SHALL write only the global package directory and the backup directory.

#### Scenario: Only expected paths change
- **WHEN** install runs against a temp prefix
- **THEN** only the global dir and backup dir SHALL contain new entries
