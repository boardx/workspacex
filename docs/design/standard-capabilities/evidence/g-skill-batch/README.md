# S001–S008 real-model acceptance batch

This is an opt-in lane, not a new test engine. It reuses the existing canonical Vitest isolation configuration and the S009 live fixture pattern. `vitest.skill-batch-real-model.config.ts` includes only the new `.live.ts` file and requires an explicit case, owned sandbox and evidence directory. Ordinary CI includes only `*.test.ts`, so it does not silently invoke an external model.

All inputs are synthetic literals in `skill-batch-scenarios.ts`. Each run creates a new isolated organization, uploads only that case's synthetic input, binds it to the actual human message, and uses the real native input reader, session owner, authority, sandbox, staging, object store and existing artifact-version writeback. Knowledge and web services come from actual `createApp` production composition; there is no fake search/source response. Python binds the configured real ChatOpenAI model to the official native factory. Only configuration existence is checked; credentials are neither recorded nor printed.

Cases S003–S006 use the existing four canonical Office packages. Other cases load the real starter package manifests. Negative arithmetic prompts must invoke no tools. A successful process is not enough: source facts, calculations, citations, actual published bytes, and relevant rendered pages require semantic/visual review.

## Current results

- S007 initial real run failed at publication of the generated Python source (`analyze.py`, `text/plain`); see `S007/source-delivery-before.txt` and retained trace. Actual model computation and report text were observed, but file delivery failed. This is not a G-SKILL pass. It is being reviewed as a file-type compatibility gap, not bypassed by dropping the required source-code deliverable.
- S007 rerun after the narrow `.py` publication fix passed the live test and actual three-file writeback. See `S007/source-delivery-after.txt` and `S007/REVIEW.md` for arithmetic/source verification and generated-text quality limits.
- S001 and S008 passed the genuine model, source identity/version comparison, artifact writeback and zero-tool negative control. Their directories contain raw logs, exact source, artifacts, model traces and manual reviews.
- S002 final rerun passed genuine search/fetch, explicit failed-source handling, full source ID/hash comparison, artifact writeback and zero-tool negative control. Initial hard failure, recursion evidence and rejected draft remain preserved. See S002/REVIEW.md for the final semantic review and scope.
- S003, S004 and S005 now pass actual model generation/writeback and independent structural/visual review for their representative synthetic documents. S003 includes an explicit correction of a reviewer preview misreading; S005 retains its original budget failure and successful new-package rerun.
- S006 page selection passes actual packaged selection, two-page bilingual rendering and writeback. Its separate S006_FORM case now passes real-model filling, actual writeback and independent new-session AcroForm field reopening; it is the same S006 capability.

The shared cached `workspacex-skill-sandbox:w14-audio` image is reused through an independently named compose project. Each DB wrapper cleans its own resources; the separately owned sandbox is released at batch completion. External provider unavailability must remain a failed/blocked result, never a substituted model or fabricated success.

## Reproduce one case

```sh
source scripts/real-model-env.sh
real_model_load_env_file /Users/shenyanbin/Documents/workspacex
WX_NATIVE_SANDBOX_CONTAINER=wx-skill-batch-audit-skill-sandbox-sessions-1 WX_SKILL_BATCH_CASE=S007 WX_SKILL_BATCH_EVIDENCE="$PWD/docs/design/standard-capabilities/evidence/g-skill-batch/S007" pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run --config vitest.skill-batch-real-model.config.ts
```

Run only while holding the shared DB slot and with the explicitly owned sandbox running. No default test invokes this lane.

For emitted Office packages, the read-only standard-library helper `apps/deep-agent-service/tests/skill_batch_office_inspect.py <artifact>` extracts actual XML and checks ZIP bounds; PPTX must have three slides and XLSX must contain a SUM formula whose stored cache is 42. This helper never executes model-generated code. DOCX page count, PDF page selection/text, bilingual layout and visual overflow still require inspection of actual rendered outputs before acceptance.
