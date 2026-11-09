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
