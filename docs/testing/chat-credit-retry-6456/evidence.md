# Chat Credit retry lifecycle — #6456

The real Panel, PlanControl and root CreditConsumptionNotice were mounted in a temporary local preview. Only fetch responses were synthetic; no real quota or model call was made. IAB was used because native Chrome was blocked by the locked Mac.

Before retry both composer Credit error and organization usage notice were visible. Clicking the real retry control cleared both; the successful restored run left both absent. A fresh retry returning a new failed run displayed the current composer error and organization notice again. See before.png, success.png, new-failure.png.

The fixture initially supplied an invalid ledger gate reason, then was corrected to the canonical `no-plan`. The SDK thread-list fixture remained incomplete (`threads is not iterable` dev overlay); this limits the browser evidence to the exercised Panel retry/restore path, not a clean full-product E2E. The temporary route was removed.

Targeted tests: actual Panel/PlanControl 61 passed, 4 existing skips; scoped notice and silent API observation plus restore-on-remount 9 passed; hook StrictMode and bounded restore race suites passed; credit guidance 16 passed; failure cause banner 9 passed. Races cover delayed retry POST resolve/reject after org switch, old restore failure/401 after new attempt, late old failure and unbound old success, preserving independent cancellation errors.

No backend, quota, recharge, billing admission or production configuration changed. Synthetic retry message/title pollution is tracked separately in #6457 and is not implemented here.

Final checks: `pnpm --filter web typecheck` exit 0 after temporary route removal; ESLint all changed source/tests exit 0; `git diff --check` exit 0. Baseline `./init.sh` passed. `harness tick` unavailable because COORD_GATEWAY_URL is unset. No owned preview server remains.
