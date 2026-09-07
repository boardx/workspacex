# W14 image generation evidence

This increment implements square text-to-image generation through the existing BailianImageProvider. Output is generated workspace metadata; wx_artifact_publish and existing writeback create actual artifacts afterward. It does not claim external model quality or G-SKILL.

## Commands and results

- `pnpm --filter @repo/contracts exec vitest run tests/standard-image-tools.test.ts`: 2 passed (contracts.txt).
- `apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_image_tools.py -q`: 5 passed (python.txt).
- `pnpm exec tsx skills/standard-visual/scripts/build.ts` then `pnpm exec tsx skills/standard-visual/scripts/verify.ts`: complete four-file loader and tampering rejection passed (skill-package.txt).
- First standard isolation wrapper ran `pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-image-tools.test.ts tests/agent-runtime/image-production-di.test.ts tests/agent-runtime/bailian-image-bounds.test.ts`: service 6 and provider 8 passed, then PostgreSQL client emitted 57P01 terminating connection due to administrator command. The overall command failed and is **not** a passing suite. Cause was not established; original log retained in first-run-interrupted.txt.
- Independent rerun below: production DI 1/1 and complete native chain 1/1 passed, exit 0, wrapper cleanup completed (live-tests.txt). The connection failure did not reproduce.

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-image-tool-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/image-production-di.test.ts; pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'
```

Sandbox used existing `workspacex-skill-sandbox:w08-ocr` via compose sessions override and independent project wx-image-tool. `docker compose -p wx-image-tool -f apps/skill-sandbox/docker-compose.sessions.yml -f /private/tmp/w08-ocr-override.yml down --volumes` completed. No image or resource budget changed.

## Actual chain evidence

Real official Python factory calls wx_image_generate, actual Bailian provider class performs local HTTP submit/poll, guarded TLS download returns a complete PNG, real sandbox Pillow verifies/decompresses 1024x1024 bytes, artifact_publish stages it and existing PG/storage writeback creates three final artifacts/attachments. The PNG SHA256 is 5025fd30defaaa5cfbfca813751d1c309f992873dd0f3631aaa8f90b017918d7 (18781 bytes). Stored output equals fixture bytes. Vendor submit count is one and immutable intent existed before submission acknowledgement. Fixture is apps/api/tests/fixtures/generated-image/square.png.

Unit counterexamples cover changed-argument conflict, restart/new tool call replay, concurrent intent, lost acknowledgement without resubmit, current authority/local-only egress denial, unavailable references, authorized but unsupported editing, and codec failure. Unit codec/provider are fakes; complete-chain codec/storage are real.

## Boundaries

Only square generate is supported. References are authorized then editing is explicitly rejected. Unresolved durable intents are not automatically retried; automatic cleanup of orphan intent/image objects is not verified; the new prefix still needs retention-policy integration. No vendor URL, credentials or fabricated ready artifact ID enters results. S017 is a complete method package adapted from Apache-2.0 anthropics/skills canvas-design at ef740771ac901e03fbca3ce4e1c453a96010f30a; original license retained. Visual inspection of actual external generations remains required. Platform seed registration and root-owned shared integration are separate changes reviewed by root.

## Owned implementation manifest

- packages/contracts/src/standard-image-tools.ts
- packages/contracts/scripts/generate-standard-image-schema.ts
- packages/contracts/tests/standard-image-tools.test.ts
- apps/deep-agent-service/src/deep_agent_service/generated/standard_image_schema.json
- apps/deep-agent-service/src/deep_agent_service/standard_image_tools.py
- apps/deep-agent-service/tests/test_standard_image_tools.py
- apps/api/src/application/agent-run/standard-image-tools.ts
- apps/api/src/infrastructure/agent-run/standard-image-service.ts
- apps/api/src/infrastructure/agent-run/generated-image-downloader.ts
- apps/api/src/interface/controllers/standard-image.controller.ts
- apps/api/tests/agent-runtime/standard-image-tools.test.ts
- apps/api/tests/agent-runtime/image-production-di.test.ts
- apps/api/tests/agent-runtime/native-full-chain.test.ts
- apps/deep-agent-service/tests/native_full_chain_runner.py
- apps/api/tests/fixtures/generated-image/square.png
- skills/standard-visual/ (skill, references, license, build/verify scripts)
- skills/starter-packs/standard-visual/1.0.0.json
- docs/design/standard-capabilities/image-generation-delta.md
- docs/design/standard-capabilities/capability-catalog.json (T038 output summary only)
- docs/design/standard-capabilities/evidence/W14/

Shared root/peer-owned wiring is intentionally not listed as worker ownership. No git operation performed.
