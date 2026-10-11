# Explicit content-filter refusal isolation — #5602

Controlled local reproduction found an HTTP 200 response with
`choices[0].finish_reason = "content_filter"` was not classified as a content
rejection. A null message failed the research workflow; partial content was
accepted. The same omission existed in the streaming adapter.

The adapter now rejects only that exact protocol value, preserves numeric usage
and error classification through stream wrapping, and lets existing research
batch isolation discard refused evidence. Generic HTTP 400/401 and unclassified
empty responses retain their failure behavior. The refusal frame contributes no
content; already emitted earlier stream deltas are not retrospectively removed.

## Reproduction and validation

Before the production change, running both new test files produced **6 failed,
9 passed**: first and regenerated reports failed, complete null/partial refusals
were mishandled, and streaming null/partial refusals were mishandled. After the
change the same command produced **15 passed**.

```sh
pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts tests/research/guided-provider-content-rejection.test.ts tests/research/guided-provider-content-filter-runtime.test.ts
pnpm --filter @repo/api test:research-unit
pnpm --filter @repo/api exec vitest run --config vitest.usage-unit.config.ts tests/agent-runtime/configured-model-provider-stream.test.ts tests/agent-runtime/configured-model-provider-max-output.test.ts
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api lint
./init.sh
```

Full research suite: **38 files / 842 tests passed**. Shared provider stream and
output-budget suite: **2 files / 33 tests passed**. Typecheck and default init
exited 0. API lint exited 0 after replacing an ambiguous batch-index literal in a
length assertion with the named refused batch index; no scanner or baseline
was changed. Additional cases cover null/empty/nonempty refusals, stream partial
output followed by filtering, and actual runtime first/regenerated fatal
400/401/stop-empty/unknown-empty responses with previous reports retained.

The runtime tests use real loopback HTTP through ConfiguredModelProvider and
GuidedRuntimeService, the controlled 23-batch geometry fixture, fixed semantic
verdicts and cloned memory writes. Both first generation and regeneration save
four sections, retain 32 unique question evidence entries, have no draft or quality
warnings, and call refused batch index 15 exactly once. Regeneration retains the
previous report. This validates refusal isolation and save calls, **not real-model
semantic quality or database durability**.

This is a newly proven local defect. The original online request's safe backend
errors remain unavailable; these results do not establish its root cause or
claim the deployed application has recovered. No deployment or online generation
was performed.

Protocol reference: [OpenAI Chat completion finish reasons](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/retrieve).
