# W15 complete draft artifact and governed import

This increment implements the native `wx_skill_create_draft` consumer, complete JSON package artifact, and an explicit administrator artifact-import adapter into the existing importer. It does not revive POST /skills or create a second Skill/version store.

## Evidence

- Final API lint and typecheck both exited 0; complete logs retained.
- Contracts 2/2: generated Python schema matches and admin import accepts artifact identity rather than URLs/model storage keys.
- Python 5/5: trusted tool-call identity, no model namespace override, bounded failures/no secret disclosure/no automatic retry.
- Final API group **10/10**: four draft checks (actual FsObjectStore immutable bytes, metadata/content replay conflict, concurrent winner, missing references/runtime/path/UTF8 rejection and late-write cancellation), one explicit changed-pack replay conflict, five existing frozen POST /skills checks.
- Actual native fullchain **1/1**: original document/web chain retained; model calls execute, which actually runs the generated Python script in the isolated sandbox with a five-second timeout and exact `42` assertion, then calls draft creation and JSON artifact publication. Existing PG writeback creates two artifacts/attachments. An administrator imports that actual immutable JSON artifact version through HTTP and the original repository; both Skill files read back with original hashes. Ordinary member gets 403, an admin without private thread visibility gets 404, wrong digest gets 422, authorized import gets 201 then idempotent 200.
- S015 full four-file 1.0.0 package (including Apache license) passes the actual FileSkillStarterPackSource verification.
- Initial tests caught sentence-final punctuation being misread as a script filename. The implementation was fixed; missing-script rejection remains tested. Red log retained.

`validationReport.fixtureExecution:not_run` refers to the packaging tool, which never executes submitted code. The fullchain records its separate real fixture execution as `draftFixtureVerified:true`. Neither proves arbitrary scripts safe or a real external-model G-SKILL run. Dynamic dependency completeness, binary template packaging and an admin UI are not claimed.

## Reproduction

```sh
pnpm exec tsx packages/contracts/scripts/generate-standard-skill-draft-schema.ts --check
pnpm --filter @repo/contracts exec vitest run tests/standard-skill-draft.test.ts
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_skill_draft.py -q
pnpm exec tsx skills/standard-authoring/scripts/build.ts --check
pnpm exec tsx skills/standard-authoring/scripts/verify.ts
docker compose -p wx-skill-draft -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-ocr-override.yml up -d
WX_NATIVE_SANDBOX_CONTAINER=wx-skill-draft-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/skill-draft.test.ts tests/skills/skill-artifact-import.test.ts tests/skill/post-skills-gone-410.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'
docker compose -p wx-skill-draft -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-ocr-override.yml down --volumes
pnpm --filter @repo/api lint
pnpm --filter @repo/api typecheck
```

The compose override selects only the existing `workspacex-skill-sandbox:w08-ocr` image. No W15 image dependency or isolation change. Database wrapper cleaned automatically; owned container and volume removed. In fullchain HTTP admin principals are explicitly supplied by test middleware while all downstream membership, source visibility, bytes, storage and importer are real. Production uses the existing principal guard, not that middleware.

## Artifact and lifecycle boundary

Pack fileDigest hashes complete JSON bytes; packDigest is the original pack-format digest. Caller must not confuse them. Draft immutable object key includes trusted org/run/call hashes. Same-call different bytes or metadata conflict; no Skill identity is fabricated. Cancellation after workspace write may leave unreferenced files/objects under the existing retention boundary, but no successful result is returned. Only explicit authorized admin import creates Skill identities according to existing importer semantics.

## Source

S015 adapts [OpenAI skill-creator at fixed SHA](https://github.com/openai/skills/blob/4ab6e0fd99c6667163bc34173e3ed3a3fed75ebc/skills/.system/skill-creator/SKILL.md). Its adjacent LICENSE.txt is Apache-2.0, retained in the distributable pack. Adaptation replaces local Codex installation with WorkspaceX's existing artifact/admin import workflow; no unrelated upstream runtime scripts are copied or claimed deployed.

## Owned files for root commit

- `packages/contracts/src/standard-skill-draft.ts`, `scripts/generate-standard-skill-draft-schema.ts`, `tests/standard-skill-draft.test.ts`.
- API application `agent-run/skill-draft.ts`, `skill-import/import-skill-artifact.ts`; infrastructure `agent-run/native-draft-session.ts`; controllers `skill-draft.controller.ts`, `skill-artifact-import.controller.ts`.
- API tests `agent-runtime/skill-draft.test.ts`, `skills/skill-artifact-import.test.ts`, updated `agent-runtime/native-full-chain.test.ts`.
- Python `standard_skill_draft.py`, generated `standard_skill_draft_schema.json`, test `test_standard_skill_draft.py`, updated `native_full_chain_runner.py`.
- `skills/standard-authoring/` and `skills/starter-packs/standard-authoring/1.0.0.json`.
- `skill-draft-integration.md` and this evidence directory.
- Root owns kernel/factory/noRetry/profile/JSON publish and starter seed integration; those changes must accompany production delivery.
