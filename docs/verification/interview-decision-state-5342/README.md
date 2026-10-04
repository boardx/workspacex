# Future plans and current decision state (#5342)

This PR is stacked on #5351 at `7940381cfd48ef55df2b3e61e33f56a6e36ac46b`. Its diff only covers #5342. Parent changes were preserved by a fast-forward before final verification.

Both unchanged public raw reports in `apps/api/tests/itv/fixtures/defect-exclusion-5341` infer current procurement suspension from a future plan to decide investment. The finite claim gate now rejects that inference unless the exact server-bound source contains the same current state clause for the same person, object and time window. Plans, quoted testimony, scoped uncertainty and conditional hypotheses remain available. Generation guidance separates plans from recorded states.

Validation: `pnpm --filter @repo/api test:interview-markdown-unit`.

- Initial reproduction: 8 failed, 237 passed (`red.txt`).
- Named conditional regression: 1 failed, 245 passed (`condition-red.txt`).
- Final verification with updated parent: 255 passed (`green.txt`). The additional 9 tests belong to the updated parent.

No model calls or private interview reads occurred. Original public inputs and raw reports were not rewritten. Overall #5327 semantic acceptance remains failed pending the remaining risk-downgrade fix and comprehensive acceptance; these controlled tests do not establish model output quality.
