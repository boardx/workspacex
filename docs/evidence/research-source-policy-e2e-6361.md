# #6361 default source policy browser assertion

Current #6372 merge-group candidate d5b4301750a1b176f1b60c72ec16b0006e876469 failed fullstack-smoke run42355963753/job128355032649 in guided-research-runtime.spec.ts:155. Both browser attempts returned the explicitly persisted default source policy {mode:open,domains:[],internalSourceIds:[],revision:1}; the old assertion required sourcePolicy to be absent.

ResearchIntake now intentionally persists selected source mode with refine_source_policy before opening the plan, including default open. The test now asserts the complete expected policy and exactly one steering command. All original intent, report, evidence, coverage, source, refresh and command identity assertions remain. No product, timeout, retry, provider, workflow or gate change.

Validation: existing research-intake-source-mode component contract suite executed on matching product/test blobs, 6/6 passed, exit0. It covers open/materials persistence before navigation, no navigation after unmount, no replay of matching persisted policy and version-bound command identity. This is not corrected full Playwright acceptance: the real current candidate failure is retained, fresh exact-head review and actual corrected browser CI are still required.
