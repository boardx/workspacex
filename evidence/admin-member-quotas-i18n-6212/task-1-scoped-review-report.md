# TASK1 scoped rereview, round 1

Scope: original two P2 findings and new breakage caused by their fixes, a6239758d → 117558254. Read the implementation report appendix and supplied task-1-fix-review.diff; initial output truncation required recovery reads of omitted ranges. No whole-TASK1 rereview, repository crawl, tests, type checking, lint, Git operations or resource operations performed. Only this report was written.

## Verdicts

- Finding 1 (duplicated HTTP failure policy): **ADDRESSED**. memberFailure now delegates to describeFailure(error, locale), whose previously reviewed canonical HTTP handling uses httpFailureText. No second status table remains. All changed quota/header/boundary/invitation-load/resend consumers pass current render-time locale.
- Finding 2 (unknown invitation error leakage): **ADDRESSED**. describeInviteFailure retains known invite mappings and 401/403 semantics; unknown API reasons and arbitrary exceptions delegate to safe canonical describeFailure. Optional locale on semantic Feedback, form field-error rendering, legacy callback rendering and invitation banner rendering propagates locale to those fallbacks. MemberInvitesPanel already supplies render-time locale when rendering notice.text. Stored failure closures receive locale at render time rather than capturing request-start locale.
- **Overall: CLEAN** for this scoped rereview. No actionable P1/P2 finding in these fixes.

Root's explicit scope ruling permits the minimal shared invitation fallback and optional-locale plumbing. The supplied scope amendment records the fallback expansion. Source diff preserves invitation request payloads, known error branches, success/idempotency/activation behavior, guards, form state and request effect dependencies. No locale-triggered request or draft-reset change was introduced by the fixes.

The two new root tests exercise actual shared InviteMemberForm submission through MemberInvitesPanel for an unknown API 502 reason/private body and arbitrary Error.message. They assert absence of private text, safe localized fallback before/after locale toggle, retained form draft and exactly one submit. This is meaningful coverage of the originally identified leak; it does not constitute browser/PG acceptance or complete pending-request locale coverage.

Supplied root evidence: two new tests first failed (2 RED, 3.04 s), then covering five-file run passed 47/47 (9.05 s; 16 new-suite tests plus 31 legacy tests); scoped 13-file ESLint exited 0. These are root-run observations, not independent reruns. Type checking, real browser/PG validation and final whole-branch review remain pending root work. This report makes no standalone postcommit browser or full-feature completion claim.
