# Chat Credit retry lifecycle — #6456

The real Panel, PlanControl and root CreditConsumptionNotice were mounted in a temporary local preview. Only fetch responses were synthetic; no real quota or model call was made. IAB was used because native Chrome was blocked by the locked Mac.

Before retry both composer Credit error and organization usage notice were visible. Clicking the real retry control cleared both; the successful restored run left both absent. A fresh retry returning a new failed run displayed the current composer error and organization notice again. See before.png, success.png, new-failure.png.

The fixture initially supplied an invalid ledger gate reason, then was corrected to the canonical `no-plan`. The SDK thread-list fixture remained incomplete (`threads is not iterable` dev overlay); this limits the browser evidence to the exercised Panel retry/restore path, not a clean full-product E2E. The temporary route was removed.

Targeted tests: actual Panel/PlanControl 61 passed, 4 existing skips; scoped notice and silent API observation plus restore-on-remount 9 passed; hook StrictMode and bounded restore race suites passed; credit guidance 16 passed; failure cause banner 9 passed. Races cover delayed retry POST resolve/reject after org switch, old restore failure/401 after new attempt, late old failure and unbound old success, preserving independent cancellation errors.

No backend, quota, recharge, billing admission or production configuration changed. Synthetic retry message/title pollution is tracked separately in #6457 and is not implemented here.

Final checks: `pnpm --filter web typecheck` exit 0 after temporary route removal; ESLint all changed source/tests exit 0; `git diff --check` exit 0. Baseline `./init.sh` passed. `harness tick` unavailable because COORD_GATEWAY_URL is unset. No owned preview server remains.

Review follow-up: live RUN_ERROR authoritative reads now return structured Credit details to the owning attempt, preserving organization recharge and member-monthly-limit guidance. Both the error bus and thrown-send callback are ownership guarded. Two actual Panel regressions cover these account-specific payloads. An initial edit accidentally referenced the send token in the event callback; tests/TSC caught it and it was removed before commit.

Fixture console attribution: GET /fixture-runtime/threads was stubbed as `[]`, while CopilotKit 1.66.4 expects `{threads: []}` and passes `data.threads` to sortThreadsByRecency; undefined caused the documented `threads is not iterable` overlay. The no-Agent hint is caused by the intentional empty `/capabilities` fixture. Neither is evidence of a product exception; neither screenshot was cropped to hide it.
