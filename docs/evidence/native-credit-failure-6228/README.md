# Native credit admission recovery — #6228

## Incident and scope

DevApp run `20d950a4-d236-40a9-aecd-b3c7efc6d171` on OCI revision `c49fee15b89f2621d8ceaa582ef6a9c0f6c931cc` failed before vendor dispatch. The exact agent log showed `CreditRuntimeUsageError: credit_required` inside the accounting HTTP transport, wrapped by OpenAI SDK as `APIConnectionError`. The API therefore reported a provider failure. A read-only transaction confirmed the initiating user had 20,000 personal credits, while the organization had no Team term, plan or wallet. No credit request was admitted for the failed run.

Human revision, recorded in issue #6228: under activated new billing, no Team entitlement or exhausted ordinary Team money falls back to the authenticated initiating user's personal wallet. Funded licensed Team pays first; legal current-generation Enterprise retains organization overdraft. Zero personal balance permits admission, negative refuses new requests. Replay and settlement retain the persisted payer. Unknown accounting facts fail closed.

Scope confirmed by the parent coordinator on 2026-11-04: preserve NULL legacy epoch compatibility. DevApp is active; CN/US activation must be checked separately before claiming this rule is active there. This PR does not migrate or activate environments.

## Verification

- Real installed LangChain/OpenAI SDK: initial eight typed-refusal cases failed with APIConnectionError (`python-red.txt`); after the boundary fix, all four sync/async invoke/stream modes preserve only the real typed exception. Four untrusted vendor-message counterexamples remain ordinary SDK connection errors. Model regression: **32 passed** (`python-green.txt`). No real vendor is used in these local tests.
- Real isolated PostgreSQL: initial six fallback cases produced four failures and two passes (`pg-red.txt`). Final seven-file regression: **42 passed**, peak four DB connections, isolated stack cleaned (`pg-green.txt`). Covers no Team wallet/entitlement, exhausted and zero Team, funded Team priority, personal zero/debt, legal Enterprise including missing wallet, unknown generation, cross-org and changed-bound rejection, replay and one debit.
- The personal fallback lock regression uses the real `PgTokenUsageRepository.record`, actual token event organization FK and `pg_stat_activity` blocked-backend barrier. A competing admission waits while receipt owns the wallet; both transactions complete. Restoring only the old Team-only settlement organization lock makes this same regression fail with real PostgreSQL `40P01 deadlock detected` (`lock-red.txt`); the fix is restored before the final green run. Errors are captured before repository retries, so bounded retry cannot hide a deadlock.

- API `pnpm --filter @repo/api typecheck` and complete `pnpm --filter @repo/api lint`: exit 0. The original financial drift guard required explicit regeneration of the single changed Team admission AST fingerprint; no permission guard or exemption changed. Independent financial security review verified that derived hash and authenticated initiator provenance. `./init.sh` fast bootstrap and `git diff --check`: exit 0.

## Remaining release gate

Independent exact-SHA review, normal develop PR checks/merge and authorized DevApp release. Then reproduce the user's real greeting and verify model response, token usage and exactly one personal credit debit. Local tests do not prove the deployed service is restored. No environment balance, privilege, credential or billing configuration was changed to bypass admission.

`pnpm harness tick` was attempted and failed closed because this checkout has no `COORD_GATEWAY_URL`; no lease, heartbeat or queue state is fabricated. Parent coordinator owns integration coordination.

## CI fixture correction

The first backend shard 8 run failed in `pg-platform-model-test-repository.test.ts`: its successful credit INSERT fake returned no rows, whereas the real SQL now uses `ON CONFLICT DO NOTHING RETURNING request_id` and correctly rejects empty results. [CI failure](https://github.com/boardx/workspacex/actions/runs/41809851183/job/126506208102). A local isolated reproduction produced 2 failures / 19 passes (`provenance-red.txt`). The fixture now asserts `RETURNING request_id` and returns the bound request ID for a successful insertion. Production guards are unchanged. The corrected platform provenance 21 tests plus actual PG fallback 10 tests pass, 31/31 (`provenance-green.txt`).

The first full Python CI job passed 872 tests with 45 explicit skips; this does not replace deployed real-model verification. Backend fail-fast cancelled other jobs after the fixture failure, so that cancelled aggregate is not acceptance evidence. New-head CI must pass normally.

Design mapping correction: Team T08/T11, domain, API and UI signoff prose now distinguish expired Team-wallet admission from the authorized initiating-user fallback, referencing the single payer rule above. The original signoff frontmatter/history is byte-preserved. This is the same human decision, with no implementation or legacy-epoch expansion.
