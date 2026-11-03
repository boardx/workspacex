# Organization members and invitation localization — #6179

The real `/org-admin/members` and `/org-admin/invites` routes now render Chinese/English copy, roles, reviewer functions, invitation states and dates. Original names, emails, URLs, role/status keys and HTTP payloads remain unchanged. The member/attendance previews use the same locale infrastructure; organization role labels reuse the shared `role.*` keys. Shared confirmation Cancel, required audit reason and toast-dismiss labels use existing common controls.

Known errors and feedback resolve at render time. Changing language preserves form input, open controls, role-denial state and one-time URLs without refetching or writing. Existing quota-screen consumers keep their string callbacks; the real invitation screen optionally receives lazy localized notices. Read-only membership, admin-only writes, last-admin denial, creator/peer review restrictions, invitation lifecycle and clipboard fallback remain intact.

## Evidence

- `unit-red.txt`: the original real-screen locale cases fail before implementation.
- `panel-red.txt`: the two shared-label cases fail before the panel change.
- `unit-green.txt`: selected 9 files / 39 tests pass, including legacy role/reviewer/scope/navigation tests and raw input/payload assertions. This final run covers the preview shared-role-key consolidation and visible-feedback locale fix.
- `typecheck.txt`: standard web `tsc --noEmit` exits0 after correcting strict callback/test fixture types, before the preview-only followups. Normal pre-push must check the final source again.
- `preview-feedback-red.txt` and `preview-feedback-green.txt`: four stale-preview-toast counterexamples before the fix, then15 preview/scope tests pass; these overlap the final39.
- `post-merge-unit-green.txt`:39tests pass after integrating developbbc63c39; all3 registered entity-localization cases were retained.
- `review.txt`: independent exact-source review, the single P2 fix/re-review and latest merge-source confirmation; no reviewer dynamic rerun.
- `dictionary-green.txt`: strict namespace/resource parity and selected locale tests, overlapping the main test set rather than additive.
- `browser.txt`: a fresh production build with real isolated API/PostgreSQL passes the registered browser case,10.2s; total6m50 including cleanup1s. It covers invitation issuance, the invitee activating in another browser context and surviving reload, original display name, admin role change and reload persistence, non-admin403, shared-link create/revoke and one-time URL preservation across language switches. No request interception replaces these operations.
- `org-members-en-mobile.png` and `org-invites-en-desktop.png`: actual375/1280 screenshots, visually inspected. No one-time invitation token remains visible in the delivered screenshots.

The production browser source includes the real member/invitation/panel code; the later preview-only followups replace duplicate organization-role keys with the existing shared keys and keep visible Toast feedback translatable. Four new feedback cases first fail, then the final39-test run passes; final pre-push/CI cover the new source. The local command targets the one case with `--no-deps`; CI retains its existing full unconditional project closure. No timeout, retry, CI policy, API, permission or database schema is changed. The new multi-account case uses the existing core-journey-02 budget before its first run.

The owned isolation scope `wsx-7f02865fa98fb421768c` has zero containers after cleanup. Shared AdminNav copy remains a separately assigned followup; these screenshots deliberately expose that existing boundary. No production deployment is claimed.
