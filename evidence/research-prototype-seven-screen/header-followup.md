# Shared header follow-up — issue #4465

The research header now reads display name and avatar from the existing session
identity and links to the existing profile route. Missing identity does not render
a fictional account. Leaving with an unsaved draft uses the existing leave guard.

Validation: 30 tests across the six-step, flow and visual-contract suites passed;
web typecheck and lint passed. Codex in-app browser reopened the topic fixture at
1448 × 1022. The reference-sized layout remains intact. This anonymous fixture
does not validate an authenticated profile; the unit test supplies an identity.

This is not a claim of full one-to-one completion. Notification placement,
background imagery, list-fixture search/filter coverage and remaining screen
geometry still need work. Existing reference fixture counts are not live research.
No automatic merge or production deployment was performed.
