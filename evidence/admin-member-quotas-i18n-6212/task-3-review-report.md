# Task 3 independent SPEC + QUALITY review

Reviewed source snapshot: base `35bbcc9c9` to frozen eight-file working snapshot identified in `task-3-frozen-sha256.txt`. Reviewed the complete supplied `task-3-review.diff`, including the full new namespace. Tool-output truncation required bounded recovery reads of omitted diff sections; product files were not reread. No checks, browser, Git commands/writes, resource operations or subagents were run. Only this report was written.

## Verdicts

- SPEC: PASS for the Task 3 source scope and binding presentation/lifecycle invariants.
- QUALITY: CHANGES REQUESTED for one P2 misleading usage explanation below. This is an inherited Chinese copy defect carried into newly canonical bilingual resources, not a newly introduced calculation defect.
- This source-only review does not establish runtime/type/static/browser passing, feature completion, whole-branch approval or merge approval. Root reports 15 valid RED cases before implementation; fresh GREEN and remaining verification were pending at review time.

## Actionable finding

**[P2] Correct the assertion that failed calls never contribute tokens** — `apps/web/lib/i18n/namespaces/ai-usage.ts:240` (Chinese counterpart line 101), rendered by the failed-call statistic in `usage-monitor-tab.tsx`.

The English text says “Failures count as calls, but not as tokens”; the Chinese dictionary preserves the same absolute claim. A failed provider call can report charged prompt tokens. The focused domain evidence requested by root is explicit in `apps/api/migrations/20260812030000_f159_token_usage_events.sql:29`–34: failed rows are recorded and their tokens are no longer forced to zero when the provider reports usage. The monitor repository's `apps/api/src/infrastructure/auth/pg-token-quota-repository.ts:57`–62 sums tokens without an outcome exclusion while independently counting failed calls. Consequently an administrator can see failed calls with reported usage included in totals while the explanation claims the opposite. Update both resource strings to truthful presentation, for example “Failed calls are included; reported usage contributes to token totals.” Preserve all aggregation and request behavior. Chinese compatibility does not require preserving a materially false explanatory assertion. This is a localized correction of inherited copy, not grounds to alter financial logic or reclassify failure data.

Outside-diff inspection was limited to the concrete named failed-call accounting risk supplied by root: the migration header and the monitor aggregation query above, located by focused source search. No other outside-diff domain exploration was performed.

## Source assessment

Exact BigInt token, six-decimal microcost and pre-rounded credit-hundredths arithmetic remain intact; raw currencies stay separate. Default Chinese helper calls remain compatible through optional trailing locale parameters. Native quantities, unknown/unreported values, literal zero, not-applicable tokens and estimated suffixes retain distinct paths. `UNIT_LABELS` derives Chinese defaults from the pure namespace, avoiding duplicate unit copy.

Canonical `usageDay`, Shanghai boundaries, `dateQuery`, inclusive/exclusive dates, bucket aggregation, snapshot/asOf and cursor fields are unchanged. Organization/platform/self identity keys and cancellation guards remain unchanged. Locale is consumed in presentation and absent from query/effect dependencies and reset keys. Existing date drafts/errors, tabs, grain/metric, detail navigation and raw member/model/project filters keep their state and event behavior. Names, IDs, provider/model fields, timestamps and enum values are preserved. Closed usage windows remain typed separately from policy window semantics; event outcomes retain distinct tense from configured actions. Unknown action lookup uses own-property fallback. Usage-monitor error presence wraps even falsey causes and delegates display to canonical `memberFailure`.

Toolbar/window/tab wrapping and table containment changes are reasonable source measures. Actual desktop/375px geometry and reachable action visibility require browser verification; source inspection cannot prove them. `ai-usage-chart.ts` is unchanged. Reused panel changes also reach `/usage`; this review covers that shared B8 component surface, not complete B9 route-wrapper coverage. Locale display changes do not introduce pricing or funds-source changes.

After the P2 bilingual copy correction, root should run the relevant semantic/regression/static gates and real browser acceptance, followed by the separately required whole-branch review.
