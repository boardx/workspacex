# Whole-branch review — workflow grants #6207

Result: ACTIONABLE — two P2 findings in the new E2E acceptance test. No product-source P1/P2 findings.

Reviewed exact range `bfb608070b6ebb77156e63fde2d7f6b7c97101a6..708fccb7746e3a096ae60e1392056e3b056585c7`; confirmed HEAD at the reviewed tip. Read final-review.diff, all changed product/test files, binding design/plan, task and independent review reports, regression/type/modal-counterexample evidence, ledger and browser outline. Read existing provider, translation, member helper and grant contract/service code where necessary to resolve semantics.

## Findings

1. **[P2] Re-select the capability view after each deep-link reload.** `apps/web/e2e/entity-localization.spec.ts:519–521` (also 542–543). The test entered `/org-admin/workflow-grants?workflow=W029`; selecting the capability tab does not remove the query parameter. Reload remounts WorkflowGrantsScreen, whose existing mount effect restores the workflow view when that parameter exists. CapabilityCard is conditionally absent in that view, so the subsequent `artifact.getByTestId("workflow-grant-current")` assertion cannot succeed. This blocks audit/revoke/member acceptance despite correct product behavior. Explicitly select `workflow-grants-tab-capability` after both reloads before checking persisted grant state.

2. **[P2] Bind audit acceptance to events created by the current mutations.** `apps/web/e2e/entity-localization.spec.ts:516–518` and 540–541. Both audit checks search retained history only by category/action/levels/actor. With prior matching history (for example, a retry in the same test tenant), they can accept an old event even if this run's mutation fails to append its audit. The subsequent date assertion also reuses whichever event was found. The normal fullstack run uses a fresh private tenant, but the assertions themselves do not enforce freshness. Capture pre-mutation event IDs (the initial `catalog.audit` is already available), require a new matching event ID after grant and revoke, and verify those same events remain present after reload. This establishes the claimed current-operation audit evidence rather than historical existence.

## Source and evidence assessment

Presentation resources cover screen/dialog, capability explanations, levels, targets, errors and audit. Resource namespace is import-free; dictionaries register it. Chinese defaults and CAP_LEVEL are retained; optional locales reuse existing workflow/member helpers. Raw load/dialog errors and semantic notices retranslate without adding locale dependencies to network effects or canonical selection initialization. Permission checks, rank/model/API paths and arguments remain unchanged. Date rendering retains instant, options and local timezone semantics. No home/CI changes in this range.

Reported 14 actual RED cases and 76/7-file GREEN output, type output and modal harness correction were read as supplied evidence, not rerun. Canonical 22-entry before/after material is static copy evidence only. Browser source uses real requests, strict contracts, cross-tab locale propagation and independent member context; source review does not establish runtime acceptance. Init/static/list/browser/screenshot inspection and resource cleanup remain root-owned and pending at review dispatch.

No tests, typecheck, lint, build, browser, database, GitHub operations, commits or source edits performed. Only this requested review report was written. No deferred findings.
