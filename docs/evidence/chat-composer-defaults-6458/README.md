# Chat composer defaults — #6458

User request: temporarily hide the document auto-approval switch and realtime conversation entry; enable document generation approval by default. Ordinary voice input stays available.

The two composer entries are commented out, with their implementations retained. The backend defaults scoped document approval on without an initial browser PUT. The existing policy API can still explicitly disable/re-enable it using an organization-scoped opt-out marker in the existing standing-policy store. No new account, table, migration or production configuration write is needed. Historical opt-in grant rows no longer decide this default; no compatibility path is added.

The tool gate continues to require the existing document attribution. Unknown skills, unattributed execute calls and plan-confirmation gates retain their existing approval behavior. Missing grant storage does not imply permission.

Validation: observed default-policy and composer regressions fail before implementation and pass afterward. PostgreSQL tests exercise all four document skills without pre-grants, explicit opt-out, cross-skill and raw execute boundaries. Independent security/code review reported no actionable P1/P2 findings. Full results recorded on the PR.

The real-model PDF test now observes the hidden toggle, configures any pre-existing explicit test-account opt-out through the existing API and restores the original state afterward. No paid real-model generation was run for this UI change.

Not deployed to CN by this change.

Results:
- Document policy / scoped PostgreSQL / plan-confirmation: 17 passed.
- Generic permission scopes, decision history, native skill risk: 13 passed.
- Composer / voice / toggle UI: 29 passed (five files).
- API typecheck, API lint and Web lint/design passed. Initial Web typecheck exposed stale fabric-markdown dist missing modelToMarkdown; rebuilt the dependency, recheck required.
- Initial UI and default-policy regression tests were observed failing before implementation.
- Owned PostgreSQL stack chatdefaults6458 (loopback 56334) removed after tests.


Follow-up after CI failure:
- Merged current develop; preserved both entries in mod-chat knowledge-log conflict.
- Baseline execute-run.ts was byte-identical on PR and develop and had 1396 lines against the existing 1393-line gate (#6460).
- Observed the gate fail locally, then extracted the existing pure trimHistoryToBudget function verbatim into its own module. Updated its two test imports. No threshold/skip changes.
- Thin gateway + history trim + assembly: 23 passed; independent review found no P1/P2.
- Previous Web typecheck dependency rebuild was rechecked successfully before the original push (35/35 checks).
- Full previously failing usage-unit lane: 70 files / 677 tests passed. Merged composer/voice UI: 29 passed. Executor is 1368 lines under the unchanged 1393 ceiling.

Review follow-up (discussion_r4510110379):
- The organization opt-out marker must not appear as a revocable normal grant: revoking it would increase authority.
- Reproduced list leakage and direct-ID revocation with both existing controllers and the real in-memory store (two RED cases).
- Generic listing filters the policy marker; generic DELETE returns GRANT_NOT_FOUND for its id before mutation. Dedicated policy API remains the only way to change it.
- Ordinary grant deletion still works, and opt-out remains false/enforced after list and revoke attempts.
- Added these regressions to the lightweight usage-unit lane: 71 files / 680 tests passed. Independent security re-review: no remaining P1/P2.
