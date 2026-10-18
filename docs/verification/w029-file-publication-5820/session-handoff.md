# W029 PRD file publication — #5820

Scope: D003/W029 from the user-approved 10-role / 20-workflow / 50-Skill batch. Previous owner stopped writes. This task continues under the original task-specific Agent registration waiver verified by the parent from user history. No coordinator identity impersonation or credential creation; no production deployment, migration, content sync, paid model action, or permission expansion.

Base: main `3eb7d004c263e2adb55c46a2553178a1c37de681`. Independent worktree `/workspace/digital-w029`, branch `worker/digital-w029-file-publication-20261018`; original `/workspace/workspacex` preserved.

## Behavior

- Publish the assembled PRD through existing `materializeArtifact` inside the existing `artifact.write` effect. Markdown includes problem evidence, requirements/priorities and metrics; provenance retains workflow/instance and PRD digest, synthesized=true and semanticSupportVerified=false.
- Retain the immutable file receipt in the existing finalized effect result and persisted stage output; keep the existing output URL and notifications.
- Existing instance-output endpoint authorizes the requester first, reads the recorded artifact version and actual stored Markdown/provenance, and checks the combined version hash before returning saved-file text. No new download authorization route or project binding.
- Existing output page opens the saved Markdown and downloads those bytes. Reload reopens storage; historical JSON-only instances remain readable without a saved-file claim.

## Current evidence

- API/Web `init.sh` quick path passed using pnpm 9.15.0 and the repository CI-supported `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. This does not validate the desktop Electron binary. Logs: `/tmp/digital-w029-init.log` and `/tmp/digital-init-api-web.log`.
- Real filesystem write/read/reopen, hash-corruption rejection, authorization-before-storage and historical compatibility: 3 tests passed (`/tmp/digital-file-unit2.log`). Repository is a test double in this suite, so it does not prove PostgreSQL persistence.
- Related runtime/trigger/discovery regression: 20 tests passed (`/tmp/digital-related-unit.log`). Output viewer: 7 tests passed (`/tmp/digital-web-unit.log`).
- API, Web and Contracts typechecks and API/Web lint passed (`/tmp/digital-api-type2.log`, `/tmp/digital-web-type2.log`, `/tmp/digital-contract-type.log`, `/tmp/digital-api-lint.log`, `/tmp/digital-web-lint.log`). Web typecheck initially found a union-title access, corrected to the PRD branch before its successful final run.
- Existing real PostgreSQL/HTTP W029 test extended to check actual artifact/version rows, immutable file receipt and repeated reopening. Existing browser journey extended to open and download the saved Markdown and compare the downloaded bytes, then reload the same version. These additions are not claimed as locally passed.

## Blocker

The isolated PostgreSQL/HTTP attempt executed zero tests. Its required `localhost/workspacex-postgres-age:pg16-age1.6.0` image was absent, and the repository Dockerfile build failed because container connections to `deb.debian.org:80` and `apt.postgresql.org:80` were refused. Original output: `/tmp/digital-prd-db2.log`; plain build diagnostics: `/tmp/digital-pg-build.log`. No mirror, firewall, base-image substitution or migration skip was used. The same prerequisite blocks the existing full browser journey. CI with the standard image/network still needs to execute these paths.

Real model quality is unverified; filesystem/UI tests and loopback models do not certify professional output quality. W027 outline/fieldwork adapters and other accepted journeys remain outstanding.
