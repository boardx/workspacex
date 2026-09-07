# S009 real-model acceptance and bounded fixes

## Final accepted scenario

`1.1.1/acceptance-tests.txt`: **1/1 passed**, 36.92-second test, 41-second isolated wrapper including cleanup, peak two database connections. Actual configured `qwen3.8-max` selected the meeting-minutes skill, read its full fixed instructions through real sandbox `cat`, consumed an actually uploaded synthetic bilingual transcript, generated and read back Markdown, called `wx_artifact_publish`, and completed the existing PostgreSQL artifact-version writeback. The observed `body_read` event identifies meeting-minutes **1.1.1**. The unrelated arithmetic negative made **zero tools calls**. This is one real-model positive and one bounded negative, not a population-level reliability estimate.

Manual full-text review of `1.1.1/minutes.md` confirms the summary and detailed sections preserve the confirmed decision, the undecided microphone suggestion, unknown assignee/date, and s1/s2/s3 source locations. They do not upgrade non-decision into rejection. The real output SHA-256 is `1ddb1de45f7a406218ef539a37b5d32e858e8700f20ab212e2b2e5d8492a4c6a`; one actual artifact version was written. `model-trace.json`, source and result are retained in the same directory.

The package is `standard-audio@1.1.1`, digest `dc1bd12ee048c407a62ef4b75a6241aea2421c3993c69f8d5544af124b51eeb6`. Only meeting-minutes advances to 1.1.1; audio-transcription remains 1.1.0. The old 1.1.0 pack remains immutable, mechanically checked against its recorded digest and unchanged transcription skill. Root owns production seed registration; creating this pack does not itself publish a platform version.

## Exact live command

From repository root, using only the existing configured model and generated synthetic input:

```sh
source scripts/real-model-env.sh
real_model_load_env_file /Users/shenyanbin/Documents/workspacex
WX_AUDIO_REAL_EVIDENCE=/private/tmp/w14-audio-real-model-1.1.1-final WX_NATIVE_SANDBOX_CONTAINER=wx-audio-real-model-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run --config vitest.audio-real-model.config.ts
```

The explicit `.live.ts` configuration keeps external-model calls out of ordinary CI. The test fixture requires an explicitly owned container and output directory. Secrets are loaded in-process and never included in evidence or model messages. `input-scope.md` records the initial automatic approval rejection and subsequently accepted synthetic-only scope. No real user recording or document was sent.

## Failures were not relabeled as passes

Earlier logs remain failures: real concurrent read 409, omitted fixture planning grant, insufficient fixture node budget, undisclosed artifact filename-extension requirement, and the 1.1.0 semantic error. `semantic-review.md` explicitly overrides the earlier technically green run as a quality failure. The later 1.1.1 run using execute was also retained when its overly narrow read_file-only assertion failed; the assertion now accepts actual complete pinned bytes from a successful correlated cat response, not merely command syntax.

`parallel-read.md` records 39 passing actual sandbox/transport tests after serializing same-adapter operations. `cat-activity.md` records 48 passing tests after the bounded verified-cat observation. General arbitrary-script read tracing and cross-process serialization are not claimed.

## Remaining boundary

S016 live ASR accuracy is **not verified**. The configured environment lacks `KERNEL_ASR_PROVIDER`, `KERNEL_ASR_BASE_URL`, `KERNEL_ASR_API_KEY`, and `KERNEL_ASR_MODEL`; no text-model key was assumed to grant ASR access. The separately recorded actual 60-minute transport/decoder tests use a deterministic local ASR protocol fixture and are not real-vendor recognition-quality evidence. This S009 input is a synthetic 90-second transcript, not a 60-minute real-model meeting benchmark.

All our DB wrappers cleaned automatically. The owned `wx-audio-real-model` sandbox project and volumes were removed after final acceptance; see `1.1.1/cleanup.txt`. No peer containers or ports were touched.

## Change ownership for root commit

- `apps/deep-agent-service/src/deep_agent_service/sandbox_backend.py`: same-adapter bounded serialization and successful execute observation.
- `apps/deep-agent-service/src/deep_agent_service/native_skill_activity.py`: narrowly verified cat body-read facts.
- `apps/deep-agent-service/tests/test_sandbox_parallel_reads.py` and `test_native_skill_execute_activity.py`: actual-container and failure counterexamples.
- `apps/deep-agent-service/tests/audio_skill_real_model_runner.py`.
- `apps/api/tests/agent-runtime/audio-skill-real-model.live.ts` and `apps/api/vitest.audio-real-model.config.ts`.
- `skills/standard-audio/meeting-minutes/SKILL.md`, `skills/standard-audio/scripts/{build,verify}.ts`, `skills/starter-packs/standard-audio/1.1.1.json`.
- This evidence directory.

Root separately owns the shared artifact-title description and generated schema fix, plus platform seed registration. No agent graph/factory/kernel edits were made in this bounded task.
