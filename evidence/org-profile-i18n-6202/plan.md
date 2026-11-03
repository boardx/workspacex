# Organization profile implementation plan

> For agentic workers: use subagent-driven development, then task and final review, real verification and normal PR delivery.

**Goal:** complete locale switching for real organization profile and both attached authorization/memory panels.
**Architecture:** render-time typed resources, raw failure/validation state, stable API/effect boundaries.
**Spec:** evidence/org-profile-i18n-6202/design.md and issue6202.

## Task 1 — Complete profile and attached-panel localization

Ownership: only apps/web/components/org-admin/org-admin-screen.tsx (OrgProfileScreen and OrgProfileTab, not existing member/invite code), standing-tool-grants.tsx, knowledge-extraction-toggle.tsx in that folder; new apps/web/lib/i18n/namespaces/org-profile.ts; messages/en.ts and zh-CN.ts; controls.ts only for new shared common.save/common.saving. Optional small pure display helper under lib/i18n only if necessary, report it first. Root owns tests, browser, fixture, evidence. Do not commit, checkout, push, create worktree, edit API/runtime/config/provider/permissions or spawn subagents. You are not alone; preserve other edits.

- [ ] Read evidence/org-profile-i18n-6202/design.md first. Worktree /Users/shenyangjun/boardx/workspacex-i18n-agent-skill, branchworker/i18n-org-profile-6202, base8afe95eb18f84ac848bee698935fe9db7de74cf5 (Nav dependency explicit).
- [ ] tests/ui/org-profile-i18n.test.tsx has10 root-owned semantic counterexamples: first8actualRED, extra2actualRED; implement until10green, never weaken tests. Test copy exactness is the specified UI copy, not a request to alter data or authorization.
- [ ] Reuse canonical Nav profile title, ui.organization fallback and state.saved. New namespace owns all remaining labels/help/errors/denials/empty/busy/validation/avatar notices. Shared save/saving may be added once in controls, not duplicated elsewhere.
- [ ] Preserve exact profile read/save/avatar upload/invalidation/updateOrgName behavior and DESCRIPTION_MAX. Name/description/File payloads retain raw curly-brace text. Never translate saved input contents.
- [ ] Localize fields and visible errors lazily. Existing typeFeedback in org-admin-screen can be reused; if stored functions are used, wrap setters to prevent React executing them as updaters. Raw errors plus render-time describeFailureFor(...,t) are also allowed. Do not change describeFailureFor behavior for existing members/invites.
- [ ] Standing grants: title/help/denial/dep-failure/empty/approver/missing approver/date/revoking/revoke/revoke404/error all consume locale; preserve raw row values and grantId. Use new Date(row.grantedAt).toLocaleString(locale) with the existing default formatting shape. Exact test phrases: Approved by {raw userId}, Revoking…, This grant no longer exists. Locale does not call list/revoke again or clear a pending operation.
- [ ] Extraction: title/help/toggle label/denial/dep-failure/noncapable/read-only/busy/error all localized. Exact English toggle label Enable memory extraction for this organization; noncapable text includes Not active;403error Only organization administrators can change this setting. Keep booleans, disabled conditions, original PUT/reload flow and no-effect-on-locale.
- [ ] Profile exact English field labels Organization name / Organization description; validation Organization name is required and Description cannot exceed {max} characters; avatar rejection begins The image exceeds the 5 MB limit. Keep original Chinese wording. Saved feedback reuses state.saved.
- [ ] Run only focused10 tests+targetESLint with max1worker when root explicitly grants the short validation window. No init/fulltsc/PG/Next/browser/push. Before any test ask root if window is free; product editing is light and allowed now.
- [ ] Write .superpowers/sdd/org-profile-6202/task-1-report.md with changedfiles, all user-facing branches inventoried, tests/exit/concerns, exact API/query invariants preserved. Return brief status only.

## Task 2 — Root integration and real evidence

- [ ] Add actual admin/member profile browser to existing registered entity spec, test raw drafts/save/reload/403 and attached grant/memory controls using real API/PG. Seed prerequisite grant only through existing tenant persistence; no prefilled translation/outcome.
- [ ] Existing knowledge-extraction-toggle/tool-permission-card/org-admin regressions, resource parity, webtype/lint/init, independent reviews, valid seed replay if seed changes.
- [ ] Publish independent PR only after actual Nav6201 merge makes its inherited delta zero; normalpush, author follows both newheadCI/nativecandidate. Main alone queues/merges.
- [ ] Continue stage4 home-config then workflow-grants complete subtrees, not a final stop after this PR.
