# #6245 implementation evidence

Code connects the existing native image skill/tool/artifact path to Qwen3 standard1024, Qwen3 Pro2048 and Z-Image icon1024. This is not a claim that devapp has been activated or that live general-assistant model selection has passed.

## Verified locally

- apps/api `vitest.image.config.ts` (including exact integer10x quote arithmetic): bounded provider/service/selection/admission tests; protocol dispatch uses the exact admitted serialized body. Qwen uses asynchronous image-generation/generation and output_image_count; Z uses synchronous multimodal-generation/generation and prompt_extend=false. Admission refusal dispatches zero supplier requests; failed responses settle failed, never generated.
- Real Pillow11.3 via an isolated temporary Python environment: actual1024 and2048 PNG bytes pass the service's hash/Pillow decode/load/size checks, immutable object persistence, workspace write/readback and idempotent replay. Test session maps /workspace into a temporary directory. These are real codec tests with a local session adapter and local generated fixtures, not remote sandbox or supplier-model evidence.
- API TypeScript checks resolve the current checkout's contracts. This worktree had dependency directory symlinks into the original checkout; local package dependency directories now retain shared vendor links but @repo/contracts resolves here. No original-checkout dependency was modified.
- Contracts tests and generated Python schema agree; standard-visual1.0.2 package builder/check and actual FileSkillStarterPackSource verification pass. Existing1.0.0 and1.0.1 files remain unchanged.
- Activation CLI without devapp credentials exits DEVAPP_OPERATOR_ORG_AND_COOKIE_REQUIRED before any HTTP call.

Commands:

```sh
pnpm --filter @repo/api exec vitest run --config vitest.image.config.ts
WX_IMAGE_PYTHON=/tmp/qwen-image-pillow-env/bin/python pnpm --filter @repo/api exec vitest run --config vitest.image.config.ts
pnpm --filter @repo/api typecheck
pnpm --filter @repo/contracts exec vitest run tests/standard-image-tools.test.ts
pnpm exec tsx packages/contracts/scripts/generate-standard-image-schema.ts --check
pnpm exec tsx skills/standard-visual/scripts/build.ts --check
pnpm exec tsx skills/standard-visual/scripts/verify.ts
```

## Unverified boundaries

The added real-PG platform snapshot test uses the actual seeder -> PgEnabledSkillVersionReader -> PgAgentRunRepository.readPinnedSkills chain to assert the current general-assistant skill bytes are1.0.2 and contain all three models/tools. Its local isolated run was terminated while waiting for machine load admission (per-core load exceeded2.5); no test ran and no stack was allocated. CI must execute it. Existing message-roundtrip derives current enabled skills only for the trusted general assistant with no explicit pins; explicit pins remain frozen.

No authenticated devapp operator/run context or devapp database credentials were available. Local DB credentials are explicitly CN production and were not used. No naked supplier request was sent to bypass product credit admission. Three real user prompts, actual skill selection, supplier calls, credit ledger settlement, publish/writeback and browser display therefore remain an activation acceptance task, described concretely in activation.md.

Skill instructions require wx_image_generate and actual artifact publication, and prohibit completing the image step after failure. The existing runtime tool error remains an error. Current plan protocol has no exact image tool-call -> step identity, so no mechanical proof is claimed against all false7/7 completions. This change does not globally rewrite the plan state machine.

## Official protocol references

- https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference
- https://help.aliyun.com/zh/model-studio/z-image-api-reference

Reviewed2026-11-05. Same-region account/host/key is mandatory. The separately configured platform model-test image client still supports only Wanx; it is not used as Qwen/Z evidence. Default credit-only native chat path does not depend on that client.
