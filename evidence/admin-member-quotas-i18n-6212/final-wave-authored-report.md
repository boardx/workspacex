# Final acceptance wave — authored and frozen

Only the new administration quotas case in `apps/web/e2e/entity-localization.spec.ts` was edited. Existing cases, helpers, assertions, fixture, product code, request payloads, timeouts and retry settings were retained.

Completed all seven brief steps in source:

1. Added invitation email draft using raw `{draft}` text and a unique locale email, real helper-tab zh/en switches, visibility/value and organization-prefix request/write invariants, mobile capture and close-only cancellation. No invite POST is performed; absence of the one-time link plus unchanged observed writes is asserted.
2. Added mobile budget draft capture with Save and Cancel fully in viewport during the existing 500000 draft cycle.
3. Added helper-tab locale cycle, retained 22500.9 value, observed counters and mobile screenshot before the existing strict rule edit payload assertion.
4. Registered initial summary/calls GET response waits before Usage navigation, consumed both bodies with real aiUsage schemas, checked 200 statuses and matching initial asOf/request asOf before later navigation.
5. Selected Monthly and Calls within Usage trend, then checked both aria-pressed states and unchanged observed counters across helper locale switches.
6. Expanded the actual raw-model ledger row's native HTML details, checked retained open state, raw model/provider and CNY value across helper switches; original unfiltered native/unknown ledger screenshots remain.
7. Used the actual dropdown trigger and exact menuitemradio label. Registered filtered response waits matching exact paths and decoded raw provider/model before selecting. Parsed both responses, checked 200, original snapshot asOf in both bodies and both queries, and canonical raw IDs. Checked nonempty filtered call identities, loaded ledger, retained filter and Call details tab plus unchanged observed counters across locale switches. Added desktop/mobile filtered ledger captures.

Final authored capture count is 17: original 12 plus invitation draft, budget draft, rule edit draft and two filtered ledger screenshots. Every screenshot still requires actual generation and visual inspection by root.

Self-review used bounded source reads of the edited case and actual Select, ledger, overview, budget modal, invite modal and AdminModal sources. Dropdown radio-item semantics, Monthly label, close test ID derivation and Cancel button source were checked. No tests, type checks, lint, builds, init, Git, database, browser, resources or subagents were run. No runtime success is claimed.

Remaining acceptance risk belongs to real execution: fixture row uniqueness/read timing, rendered modal geometry, response/snapshot behavior, and all screenshot readability/overflow checks. Counters cover only the observed organization URL prefix; they do not establish global no-fetch behavior or personal/access-log coverage. Cursor/self-scope and other unexercised states remain unit-only. This case establishes no actual invitation creation/email delivery, external model execution/quality, pricing settlement or funds provenance. Root owns all static/type/full-spec/browser/API/PG/QA gates after user priority #6147 clears.
