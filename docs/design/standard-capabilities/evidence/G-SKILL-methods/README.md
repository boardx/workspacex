# Additional real-model Skill scenarios (in progress)

All inputs are agent-authored synthetic fixtures in new `*-real-model.cases.ts` files. The actual configured qwen3.8-max model uses the official native graph and existing owned sandbox, API controllers, tenant repositories and artifact writeback. No production user data, recording or credential is included in prompts or evidence. Source implementation S009 remains unchanged.

| Skill | Current evidence | Required actual path and boundary |
|---|---|---|
| S010 interview synthesis | First batch technical pass; reviewed duplicate P01/T01 counts once, P02 dissent retained, source locations and no asserted demographics | Actual uploaded input read, selected full Skill, sandbox file generation, artifact publish/writeback; supplied transcripts require no ASR call |
| S011 internal communications | First batch technical pass; reviewed unknown date/metrics and draft/no-send boundary | Actual authorized input + full Skill read, file generation/publish/writeback; no external send capability exercised |
| S012 diagram/canvas | Extended batch technical pass and reviewed actual version/source | Actual wx_canvas_read/update/read, immutable PG revision 1→2, IDs/edge retained, stale write and intruder read denied; source projection is not UI pixel validation |
| S014 project report | Extended batch pass; reviewed actual observedAt, roleCounts and absent blueprint/metrics | Actual wx_project_list/read HTTP→existing project application/repositories; no overview text substitution |
| S019 research planning | Revised 1.0.1 real-model pass and manual semantic review | All question rows mapped O1/O2, recruitment includes unfinished/dropout, declining recording/questions allowed; original failed-quality report retained |
| S015 authoring | Final real-model pass and manual package/report review | Six-file draft includes script and positive/negative assets; independent sandbox execution returns total3/exit0 and rejects negative/exit1; two actual artifact versions written back, no administrator import or enabling |
| S017 visual | Revised 1.0.1 real-model pass and manual image/report review | Catalog E004/T008/T020 offline path; report now accurately distinguishes machine checks from unavailable model visual QA. Does not verify generative-provider availability |
| S020 visualization | Revised real-model pass and manual image/report/source review | Actual offline script execution, 10/20 values, missing C not zero, decoded 800×600, separately published chart.py |
| S013 web artifact | Dependency pending | Production preview path must be available; no fake preview or static screenshot substitute |
| S018 document understanding | Dependency pending | Await current W08 patch/image and then actual parsing tool; no substituted transcript/plain-text-only acceptance |

`first-batch-tests.txt` contains 2 passed/2 failed. `extended-first-tests.txt` contains 5 passed/1 failed, with two intentionally filtered earlier cases skipped. These mixed groups are not global passing claims. Each failure and each remaining semantic issue stays visible. New immutable method versions preserve prior packages; root owns platform seeding.

The first S019 HTTP400 is retained. The exact 8643-byte synthetic write command subsequently succeeded through direct UDS in the same image (`long-command-direct-replay.txt`), and the image's actual maxCommandBytes is 65536, ruling out the earlier suspected 8192 limit. New batch relay streams now use streaming UTF-8 decoders rather than `Buffer`-chunk string concatenation. A local split-multibyte counterexample demonstrated corruption with the old pattern; the original failing chunk boundaries were not captured, so the root cause is not overstated as conclusively proven.

DB use is sequential and explicitly handed off. The owned sandbox project `wx-method-skills-real` was stopped and removed with its sessions_socket volume after final S015 acceptance; future S018 uses a separately prepared image/project. No other agent's stack is modified.

## Revised batch, 2026-09-07

Four real-model cases ran in one isolated wrapper: S017, S019 and S020 passed; S015 failed at graph recursion limit 200 after 18 actual tool calls. Wrapper cleanup completed; peak PostgreSQL connections 3. The limit was not increased. Original failure and revised traces are retained separately.

Manual review of revised artifacts: S017 poster has the exact two Chinese strings with no clipping/tofu; report accurately states model-side visual verification was unavailable and does not treat pixel statistics as glyph proof. This only verifies the offline poster scenario, not supplier image generation. S019 questions including closing and follow-ups are mapped to O1/O2; recruitment includes unfinished/dropout users; declining recording or sensitive questions is not exclusion. No research was claimed performed. S020 PNG shows values 10 and 20, zero baseline, Chinese labels and explicit missing third group; report and separately published chart.py preserve missing rather than zero. Its script contains the actual session input path, so reproduction outside that session requires supplying the saved source and adjusting INPUT_PATH. These are bounded synthetic scenarios, not universal quality certification.

S015 failure trace previously saved tool calls but not intermediate tool results/node names, so the precise final publish outcome cannot be inferred. The new batch runner now records sanitized actual ToolMessages, last message, state keys and node-update names for the next reproduction; no production graph changes were made.

## S015 graph-budget counterexample

`authoring-observed-tests.txt` and `authoring-observed/S015/partial-model-trace.json` show 200 updates, 18 model calls and 17 completed tools. Each ordinary tool round traverses 11 nodes; startup adds five nodes. The graph stopped during the eighteenth after-model chain, not because the model repeated 200 calls. The first artifact publish returned success; the next report publish had not dispatched. `authoring-node-count.json` contains actual counts. The live-only 200/100 recursion overrides were removed after root review to match production's installed LangGraph default; the existing 25-model-call harness cap and 240-second process timeout remain unchanged. No production routing/middleware was changed. A subsequent real-model rerun is required before S015 acceptance.

### Reproduction commands

Load configuration without printing values using `source scripts/real-model-env.sh` and `real_model_load_env_file /Users/shenyanbin/Documents/workspacex`. Set `WX_NATIVE_SANDBOX_CONTAINER` to the owned inputs-capable container and `WX_AUDIO_REAL_EVIDENCE` to a private temporary evidence directory. Run `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run --config vitest.extended-skills-real-model.config.ts -t 'S019|S015|S017|S020'` for the revised batch; `vitest.authoring-skill-real-model.config.ts` selects the bounded S015 reproduction alone. These explicitly named live configurations require real model credentials and are not ordinary CI tests. Never load production documents into these synthetic cases.

Default-settings S015 model completed successfully and staged both the complete JSON package and `count-sum-verification-report.md`; the test then failed because its report lookup required the literal download name `report.md`. The report lookup now permits a descriptive report filename while preserving content checks. The failed fixture evidence remains in `authoring-default/`; independent package-script execution and actual writeback still require the final rerun.

## S015 final acceptance

`authoring-final-tests.txt`: 1/1 passed, test69.53s, wrapper1m13s, peak3connections, cleanup completed. Actual model selected and read the complete Skill, created a six-file draft package, staged JSON plus verification report, and the existing writeback created two artifact versions. `authoring-final/S015/independent-script-fixtures.json` proves separately extracted package script was executed in the actual sandbox: positive total3/exit0, negative rejected/exit1, neither truncated/timed-out/cancelled. Arithmetic negative used zero tools. Manual script/report/final-response review found the synthetic requirement preserved, no network/install, and explicit draft/not-enabled/admin-import-required semantics. This does not verify arbitrary generated code safety, large-file performance, or administrator import in this live scenario (the dedicated W15 governance tests cover that separate boundary).
