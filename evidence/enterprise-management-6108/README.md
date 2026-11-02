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
