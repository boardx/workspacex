# Mobile footer wrapping fix

Status: minimal responsive fix applied; root verification pending.

Cause: root's second actual fresh-browser run passed grant PUT, new audit ID, reload, date/raw-name checks and grant-footer scrolling, then found mobile revoke Cancel visibility ratio 0.70037. The long Confirm revoke label squeezed Cancel partly outside the horizontal scrollport. DELETE and member stages were not reached. Evidence: evidence/workflow-grants-i18n-6207/browser-second/test-failed-1.png. This is newly observed responsive evidence, within the existing dialog usability scope.

Delta: added only `flex-wrap` to the existing DialogFooter className `flex justify-end gap-2` in apps/web/components/org-admin/workflow-grant-dialog.tsx. Callbacks, element order, canonical levels, state, copy, DialogContent scrolling class and shared Dialog component remain unchanged.

Self-review: inspected both footer and existing scroll class, then applied an exact single-occurrence replacement. No E2E assertions or timeouts changed, and other files preserved.

Checks actually run: read-only rg inspection and exact replacement occurrence assertion. No tests, typecheck, lint, build, browser, PG, Git, external actions or subagents.

Pending: root's serial verification with the existing actual-RED real-wheel/full-viewport guard, followed by the remaining revoke/member journey and required review/static checks.
