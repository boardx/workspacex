# Progress — 2026-10-13

Chat public sharing has been implemented and locally verified: reviewed snapshots, anonymous reading on phone/desktop, raster images, revoke management, tenant isolation and clipboard concurrency.
Independent review found one clipboard race; it is fixed with two regression completion orders.

Evidence: README.md and the adjacent test outputs/screenshots. Delivery is through issue #5655 and branch codex/chat-public-share; GitHub CI and merge remain authoritative. No production release or feature passing status is claimed.

CI follow-up: the new public route initially lacked a UI wiring manifest entry. Renamed the existing adapter to live-chat-share.ts and regenerated only sharing-related wiring facts. lint-ui-wiring, the 8 UI regressions and web typecheck pass after this correction; behavior is unchanged.
The deterministic public-reader browser spec is now included in the existing fullstack-smoke seeded CI project. The real owner/anonymous/revoke case retains its explicitly seeded fixture lane; its zero-skip local evidence is already committed. lint-spec-gate-coverage passes with the CI project discovery.
Additional harness-wide local audit: 2495 assertions passed, 8 failed. One was the user-facing error gate rejecting a reason-code empty-string fallback even though only human-language messages were rendered; removed that fallback and both error-gate tests plus all 8 sharing UI tests pass. Seven failures were in untouched release/process fixtures with strict elapsed-time limits; isolated rerun result is tracked in the PR. Full-suite local success is not claimed.
Backend CI found two single-source violations: inline local-organization kind comparison and direct pending-review flag consumption. Sharing now calls isLocalOrg and a thread-badges helper backed by the canonical messageBadges decision. API units 13/13 and the two existing gate files plus real sharing HTTP 36/36 pass after the correction. Owned recheck database/cache are released. The previous head's fullstack-smoke CI, including the newly wired public-reader regressions, passed.
