# Task 3 implementation report

Implemented the usage monitor windows, matrix and limit-event presentation; shared AI usage panel, overview charts, ledger and exact formatters. Added the pure `ai-usage` resource namespace and English/Chinese registration. All existing formatter signatures remain compatible with default Chinese and optional trailing locale. Native unit defaults reference the canonical Chinese resource.

Presentation preserves exact BigInt tokens, six decimal microcosts, already rounded credit hundredths and raw CNY/USD codes. Missing, zero, unknown, native-only and estimated consumption remain distinct. `usageDay`, date ranges/query timezone, aggregation/chart buckets, model identity keys and snapshot/cursor values are unchanged. Locale stays outside effects, query objects, reset keys and state initializers. Member display names use the shared locale-aware helper; authored names, provider/model identifiers, project references and event timestamps remain raw. Legacy event actions retain outcome tense distinct from rule configuration. Usage-monitor error presence wraps unknown causes and renders through canonical `memberFailure` rather than exposing raw error text.

Owned toolbars/window buttons/tabs wrap on narrow screens. Grouping buttons wrap long raw values and table wrappers contain horizontal scrolling. Root must still verify actual 375px document geometry.

Source self-review completed by reading the full dense components and changed output. No tests, type checks, lint, builds, init, browser, DB, resource operations, Git writes or subagents were run. Root owns actual semantic/regression/static/browser verification and independent review. This report makes no passing or completion-of-feature claim.

## Root actual frozen verification before review copy fix

Sevenfiles52cases: originalTask3all15 plus36existing/catalog tests51PASS; new all-failed-positive23tokens counter1validRED at incorrect explanation, total10.60s. Webscoped11filesESLint0. Root attempted ad-hoc API eslint forfixture but APIhas noESLintconfig: commandinvalid/exit2, NOT source lint failure or validation success. Correct APIpackage canonical lint and type (includes scripts) pending next resourcewindow. No type/PG/browser claim. Sourcefrozen8hashes matched review snapshot before baselinecommit; one review P2 copy-onlyfix pending.

## Scoped fix round 1

Corrected only the existing bilingual failed-call explanatory string values in `ai-usage.ts`: failed calls can include reported token usage. The prior absolute exclusion contradicted canonical aggregation behavior identified by independent review. Resource keys, parameters, computation, queries and all other source remain unchanged. Source self-review confirms the English and Chinese statements express the same accounting possibility. No tests, lint, type checks, builds, Git, browser or resource operations run; root owns GREEN verification and independent scoped review.

### Root actual round1 covering verification

Command: `WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/ai-usage-format-i18n.test.ts tests/ui/ai-usage-i18n.test.tsx tests/ui/ai-usage-format.test.ts tests/ui/ai-usage-panel.test.tsx tests/ui/admin-usage-monitor-live.test.tsx tests/lib/ai-usage-chart.test.ts tests/lib/i18n-resources.test.ts`. All7files52/52PASS9.02s, commandexit0. NamespaceESLint0, combinedelapsed11.56s. SourcefixexacttwoexistingCN/ENliterals; no otherproductdelta from9a2122525. No type/browser/PG claim. Actualprocessesexited, resourcehandofftoFIRST6214-TYPE≤60s.
