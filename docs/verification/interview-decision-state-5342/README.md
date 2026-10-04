# Future plans and current decision state (#5342)

This PR is stacked on #5351 at `7940381cfd48ef55df2b3e61e33f56a6e36ac46b`. Its diff only covers #5342. Parent changes were preserved by a fast-forward before final verification.

Both unchanged public raw reports in `apps/api/tests/itv/fixtures/defect-exclusion-5341` infer current procurement suspension from a future plan to decide investment. The finite claim gate now rejects that inference unless the exact server-bound source contains the same current state clause for the same person, object and time window. Plans, quoted testimony, scoped uncertainty and conditional hypotheses remain available. Generation guidance separates plans from recorded states.

Validation: `pnpm --filter @repo/api test:interview-markdown-unit`.

- Initial reproduction: 8 failed, 237 passed (`red.txt`).
- Named conditional regression: 1 failed, 245 passed (`condition-red.txt`).
- Final verification with updated parent: 255 passed (`green.txt`). The additional 9 tests belong to the updated parent.
- Independent review rejected the initial candidate for ordinary negations and prohibitions. Regression: 3 failed, 257 passed (`negation-red.txt`); finite negation/prohibition fix: 260 passed (`negation-green.txt`). Double denial and affirmative contrast controls remain rejected. The initial review is superseded by a new exact-head review.
- Main independent review subsequently found inner negative predicates borrowing an outer denial (`并非没有暂停` / `不是没有搁置`). Regression: 2 failed, 260 passed (`double-red.txt`); exclude these double denials from the single-negation exemption, retaining scoped prohibitions and conditional hypotheses: 262 passed (`double-green.txt`). Prior 116468 acceptance is withdrawn pending new exact review and CI.
- External `b1c43e2208dd713eaab1e93704449a2302c988f7` extended neutral attribution, `处于` and prevention syntax. Preserved by fast-forward; root/main independently rejected its negated-prevention exemption and main confirmed named-role prohibition false rejection. Regression: 9 failed, 272 passed (`prevention-red.txt`); finite denied-prevention guard, bounded named-role qualifiers and exclusion of the role word `采购者` from the procurement predicate: 281 passed (`prevention-green.txt`). Source identity/object/time and the exact proposition remain binding. Prior b1 acceptance is not claimed; new exact-head review/CI required.

No model calls or private interview reads occurred. Original public inputs and raw reports were not rewritten. Overall #5327 semantic acceptance remains failed pending the remaining risk-downgrade fix and comprehensive acceptance; these controlled tests do not establish model output quality.
