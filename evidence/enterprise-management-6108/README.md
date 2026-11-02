# Enterprise management #6108

Initial develop baseline: `b3e9977de08b056a564058ca0419d85d421fdd4a`.

Scope: platform operators can upgrade organizations with no canonical Team license row and manually grant current-generation Enterprise credits. Full paid-Team renewal cancellation and retained paid terms belong to #6116. Any Team license row, including malformed or unknown-generation rows, fails closed until that adapter exists. No production activation, merchant settlement, deployment or merge claim.

## Actual verification

- `init.txt`: initial `./init.sh` passed.
- `backend-19.txt`: exit 0; Enterprise real PG 7, precision real PG 8, authenticated real HTTP 2, generator source checks 2. HTTP uses actual bcrypt login, Redis bearer sessions and full Kernel composition; ordinary admins are denied same-org and cross-org financial writes. It verifies exact-once credit, Plan version conflicts, strict response schemas and private/no-store success and denial headers.
- `ui-client-final.txt`: exit 0; UI 11 and client response-correlation counterexamples 7. Unknown failures preserve the original key/parameters; reload never automatically submits. Wrong organization/credit/version/actor/reference responses remain unknown.
- `browser-final.txt` and `retention-pg.txt`: final no-FK schema; new retained-history PG case 1 passed (7 existing cases intentionally skipped by name selection), followed by real browser 1 passed. No previous 19/18 cases rerun. Full remaining regression belongs to required CI.

Final owned wrapper admitted normally without waiting, ran 3m8s and cleaned in 1s (total 3m9s), exit 0. Compose `wsx-35c23b19c1d24cbfe0e8` had no containers after cleanup; owned API and Next PIDs were gone. The wrapper destroyed its disposable database and retained-history rows. Next's generated tsconfig change was restored.

## Financial history and recovery evidence

The unpublished 032000 migration retains financial history without organization FKs, matching existing wallet/ledger retention. Permanent audit UPDATE/DELETE rejection and app_rw privileges stay intact. The targeted PG case verifies owner tenant teardown leaves wallet/ledger/grant/operation unchanged, direct audit mutation fails both before and after deletion, service access to the deleted organization returns not-found, and another organization is unchanged. The actual default seeded-organization cleanup hook ran. No replica mode, disabled trigger or CASCADE exception was used.

The real browser used a disposable API/PG/Redis/Next runtime. A test-only transport fault closed the first successful grant response **after the actual transaction committed**. Actual DB facts were balance 42, total granted 42, one ledger entry and one audit. Reload restored the original parameters without posting; explicit retry sent the same key and parameters and returned the original receipt. Wallet/ledger/audit facts stayed identical. The two screenshots were visually inspected:

- `enterprise-response-lost.png`: original request retained with explicit retry and unknown outcome.
- `enterprise-grant-recovered.png`: balance 42 and actual audit reference after recovery.

The expected proxy socket-hang-up log is the intentional post-commit fault, not a failed assertion. Raw final logs were scanned for bearer/DSN/password/sessionToken fields with no matches. Test fixture identities/passwords are restricted to disposable wrapper-owned acceptance runtime. Optional SQL inventory smoke was removed and was not run.

## Earlier calibration, not passing evidence

`pg-initial-setup-timeout.txt` is a cold-migration setup timeout with all cases skipped. The setup budget was corrected using observed migration duration. `pg-admission-interrupted.txt` is an interrupted resource queue before stack/test startup. Preserved UI red logs demonstrate the overflow-editability, receipt-refresh and confirmation regressions. These logs are not claimed as current successful verification.

Independent static reviews accepted the response-correlation/cache changes, permanent history retention, and warm orchestration including fresh success markers and exact text epoch restoration. Final source integration, required type/lint/CI, PR and independent exact-SHA review remain outstanding; this feature is not marked passing.

After the verified browser batch, migration replay guards were added in `ec8dd3fb6` following an actual CI force-replay failure in the sibling configuration migration. Initial table/policy/trigger definitions and financial rights are unchanged. This replay-only delta has not yet run dynamically; required migration validation/CI remains pending.

Clean preparation: replayed only 20 own commits onto reviewed capacity candidate `9001b5c25e01bc1a95d7cd619e50743de97b6466` (contains merged precision), producing `93e5f4d5bb7125b1494ba33c90289a46860f15f5`. Backup ref `backup/enterprise-6108-pre-clean-da81bf09e` retains the old stack. Full diff on all 59 owned paths was empty. Range-diff shows 19 identical own commits and one mechanically adjusted recovery-manifest patch, because 031000 is now already supplied by the base; final manifest content is identical. No runtime conflict or rewritten financial behavior. This is local preparation, not a develop-ready PR or new dynamic result.

Final prepared-base replay check: `migration-replay-green.txt` exited 0 with 449 migrations on an empty DB, force replay, identical schema/data digests, fixture preservation and append-only checks. Owned compose `wsx-4782e785d3b5d1121235` was absent after cleanup; total 2m31s including 3s cleanup. This verifies the replay-only 032000 delta without repeating business PG/browser suites.

Actual lightweight permission lint initially rejected 14 reads in the three internal financial files (`permission-boundary-red.txt`). The feature-specific structural boundary checks exact SQL/identity tuples, ordered calls, conditions and allowed receipt projections; only the reviewed composition may consume those classes/service token, and the real platform guard/CurrentPrincipal actor are verified. The allowlist count remains 162. Twelve pure-node positive/counterexample checks and actual permission lint passed (`permission-boundary-unit.txt`, `permission-boundary-green.txt`). Global fixture lint passed after only three mechanically obsolete annotations became ordinary ownership comments; cleanup was untouched. This adds no production runtime changes and does not claim final type/lint/CI completion.

First normal serial pre-push stopped at web lint after 18/25 successful tasks (10 cached), 9m24.791s; web typecheck passed but API type/lint had not completed. `normal-push.txt` preserves the missing-session-effect-dependency warning. The financial panel effect now captures token/actor primitive values with matching dependencies, retaining the same session fingerprint and organization isolation. Targeted actual ESLint passed and the two session reload/identity-transition UI cases passed (5 other cases intentionally skipped), in `session-effect-lint-green.txt` and `session-effect-unit.txt`. Full normal hook retry remains required; no push success claim.

Second normal serial hook stopped after 21/25 tasks (17 cached), 17.149s, at the architecture gate: the separate Enterprise wiring file was not registered as a composition root (`normal-push-retry.txt`). Only the exact `enterprise-management.wiring.ts` composition entry was registered, with its existing dedicated financial-boundary constraint; permission allowlist and runtime were untouched. The actual architecture gate then passed (`composition-arch-green.txt`). Full hook retry remains required.

Resource interruption: during the third normal serial hook, the main coordinator reported host load169 and required stopping new heavy work. After reporting owned PIDs, only the confirmed owner tsc15002 and Turbo12569 were SIGTERMed. `normal-push-third.txt` records shutdown and failed tsc lifecycle with 22/25 successful tasks, 21 cached, after 10m50.121s. Turbo unexpectedly returned zero after shutdown, so the unchanged pre-push wrapper continued and pushed preparation source `b75b554101da21c2100630be8bebea134f683ccf`. This is **not a successful complete hook**: API typecheck is unverified. No hook bypass or PR was used; another uninterrupted normal hook under a coordinator resource token remains mandatory. No further checks were started.
