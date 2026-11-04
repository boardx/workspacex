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

## CI follow-up

Original head `7cef4b37bc45734a3f1063b9e86e38f07c0a75f8` reached the actual PostgreSQL test in backend-gates shard 6, where W029 ended failed instead of succeeded (check annotation at problem-to-prd-e2e.test.ts:223). Inspection found a definite schema violation: creatorKind=agent with no agentRunId violates existing F44 constraint `artifact_versions_agent_run_id_iff_agent`.

The correction records the initiator as the version's committing user; the artifact is still source=ai-generated/synthesized and provenance explicitly identifies producerKind=workflow. It creates no fictitious agent run and changes no database constraint or permission. The PG test now asserts these actual stored attribution fields. A bounded stage/effect diagnostic accompanies the terminal-state assertion.

The 20 related pure tests passed after correction (`/tmp/digital-w029-creator-fix-unit.log`); API typecheck/lint and prerequisite builds passed 7/7 (`/tmp/digital-w029-creator-fix-checks.log`). New-head CI remains required to confirm the complete PG/browser path. Existing CI's fullstack dependency chain includes `official-role-workflow`/`w029-browser-journey.spec.ts`; no additional framework was introduced.

GitHub Actions job/check/annotation metadata is readable, but an attempted completed job-log download redirected to Actions log storage and returned HTTP 403. This was not retried or bypassed. Specific raw journey attachments still require access through an already permitted environment; job success alone must not be represented as having read those attachments.
