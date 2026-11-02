# Organization commercial capacity — #6107

Actual capacity facts come from `org_commercial_licenses`, with Enterprise identity solely from `organization_plans.plan` / `billing_generation`. All real member entrances serialize against the same canonical epoch / organization lock. Pending invitations do not reserve commercial seats; pending expansion never grants unpaid seats. Paid capacity survives term expiry and member removal. Legacy quota behavior remains intact.

## Verified runtime evidence

- Bootstrap quick `init.sh` exited 0 (`init.txt`). Pure contract/floor tests: 6 passed.
- Original baseline `2c3b48730`: three real business assertion failures (`pg-business-red.txt`), then identical assertions passed (`pg-green.txt`). Earlier invalid-fixture output is retained as `pg-fixture-failure.txt` and is not counted as business evidence.
- Independent review P2 baseline **`65bb2a42e91c65205c354aa024e12acf568f7160`**: controlled organization lock → activation waits → revocation commits → old activation nevertheless grants membership. `p2-red.txt` records this genuine assertion failure. Test file SHA-256: `4b58d81ca24f893001ae9db69577bd84eb77a19547af161cef257209f32ac961`.
- Applied the exact `revocation-fix.patch` statically ACCEPTed at artifact SHA `f7121e1360d136285be987b45e28877a93c7d5a4`, with no assertion/fixture changes during the window. Full capacity PG: **8/8 passed** (`pg-final.txt`, 17.70s).
- Real full Kernel HTTP: **2/2 passed** (`http-final.txt`, 145.43s). All four org roles count; forged org/role query claims do not bypass capacity; capacity failure leaves token unconsumed / account absent; invalid token remains `INVITE_NOT_FOUND`.
- Existing regressions: **23/23 passed** (`permissions-final.txt`, 75.34s): dual review 10, organization role / last-admin / concurrent mutual downgrade 8, legacy quota 5.
- One owned wrapper and one cold migration. Normal resource admission 150s; commands 6m44s; cleanup 5s; wrapper exit 0. Exact compose `wsx-c81f89481a3d3d89d37e` confirmed absent afterwards. No fallback, second stack, broad compilation, or browser run.

The original stale-invite P2 is now fixed in source: epoch shared lock → unlocked token lookup → organization lock → authoritative pending invitation `FOR UPDATE` → conditional token consumption → capacity / credential → conditional pending-to-used update. Invite-before-token matches resend and avoids the inverse lock order. Every later failure rolls back the original transaction, including token / credential / gift / outbox changes.

## Membership entrance inventory

| Entrance | Real transaction | Capacity behavior |
| --- | --- | --- |
| Single organization invite activation | `PgOrgInviteRepository.activateAll`, `withoutTenant`, token consumption + tenant context + credential + membership + invite terminal state | Existing organization membership write; commercial check must precede credential/welcome gift and throw on failure so token update rolls back |
| Shared organization link activation | `PgOrgInviteLinkRepository.activateAll`, `withoutTenant`, tenant context + link row lock + credential + membership + link counter | Same organization lock and membership count; no pending-invite reservation |
| Project invite existing/new account acceptance | `PgProjectInvitationRepository.acceptExisting/activateNew`, `withoutTenant`, invitation + membership + collaborator + verification outbox | Adds consultant only if absent; check before credential/wallet and keep all writes in original transaction |
| Project guest link / join approval | `PgInviteLinkRepository`, guest identities and project participant/membership writes | No organization membership, no commercial seat |
| Registration, personal-local, create-organization bootstrap | New organization + initial admin atomically | Cannot join an existing commercial organization |
| Platform skill catalog bootstrap | Dedicated system platform container | Not a customer organization admission |
| Seed dev account scripts | Explicit developer fixtures | Not a user-facing admission endpoint |

All org roles (`admin`, `lead`, `consultant`, `compliance`) count through `count(*)` of actual `org_memberships`; no cached seat count. No extra production direct-add/import membership writer was found in `apps` / `packages`.

## Canonical boundary

Purchased and pending seat counts are opaque-generation commercial facts; actual members are counted from `org_memberships`, never cached. Pending fields are paired. An unpaid expansion cannot increase purchased capacity; initial pending capacity constrains admission. Unknown generation or incomplete facts fail closed. The existing billing generation and active-epoch authority are reused.

`closePendingCommercialIntent` requires a matching expected purchase reference and epoch → organization lock. Paid rows retain purchased facts and only clear pending fields. Pure pending rows may be removed: tenant RLS is ANDed with a restrictive DELETE policy requiring `purchased_seats IS NULL`. Runtime tests cover paid DELETE refusal, cross-org refusal, wrong reference, and restoration of legacy behavior. No purchase, ledger or audit history is changed by the business helper.

## Clean develop replay and delivery boundary

Signed design PR #6101 is now normally merged into develop `6ed5e6833`. This branch replays only its 25 #6107 commits onto that base: `develop-replay-range-diff.txt` shows all 25 patch-equivalent (`=`), and excludes all 18 old design commits. At that replay, every capacity source/test/schema/contract/recovery file was byte-identical to reviewed old HEAD `98fceafbc` (later approved migration replay guards are recorded below); no #6111/#6120 or financial migration is included. Old source is preserved locally at `archive/team-capacity-6107-reviewed-98f`; #6111 remains on its separate branch. Root explicitly accepted the unchanged-source replay and requires no duplicate PG/HTTP/Next run.

Normal serial pre-push/static checks, separate Closes #6107 PR and CI remain pending at this record. No passing state, merge, sales activation or deployment is claimed. Runtime evidence above comes from the unchanged reviewed source. Full API typecheck was previously terminated for resource contention; this replay will use the normal hook rather than treating targeted tests as static proof.

## Normal hook internal-admission boundary follow-up

First normal serial pre-push stopped at `lint-permission-paths` (22/25 successful, push did not occur): the new internal capacity decision helper was treated as raw tenant-content disclosure. No runtime source, query or permission decision changed to address this. A single-file AST boundary now checks its exact seven scoped SQL statements, bound org/epoch parameters, five internal exports, closed projection/boolean returns, dependencies/calls, and forbids interface/application imports or infrastructure re-export. It requires the pure mutation tests and existing real PG/HTTP evidence files; the general tenant read rule is unchanged and no blanket allowlist/dummy guard was added.

`admission-boundary-pure.txt`: 12 pure cases passed, including counterexamples for raw rows, unscoped/wrong-tenant SQL, extra tenant content, logging/disclosure calls, extra exports, direct external imports and re-export. `permission-boundary-lint.txt`: actual full permission-path scan passed (2203 files/325 tenant tables). These are static gates only, not an additional runtime claim. Normal hook retry remains required after independent review.


## Live CI migration-replay fix

PR #6123 targets develop. The normal serial hook/push passed 25/25 at0f69, and again25/25 after normally merging actual precision base e676 into head1a583. The only merge resolution retains actual migration order305→031→040; no future050 was added. Runtime admission functions, tests and narrow boundary checker remain byte-identical to reviewed0f69.

Actual CI gates-runtime run41411995743/job125166902382 found a real migration defect: the empty application passed, then force replay hit an existing org_commercial_licenses relation (`ci-migration-replay-red.txt`). Independent ACCEPTed source fix e99c94d90 adds only table IF NOT EXISTS and DROP POLICY IF EXISTS before each unchanged policy definition. Fields, checks, FORCE RLS, grants and paid restrictive policy semantics do not change; the existing migration transaction keeps replacement atomic.

`migration-replay-green.txt` records the one authorized owned `migrate:check`: 448 migrations applied from empty, all448 force-replayed, identical schema and populated-data digests, fixture survival/append-only/version-record checks passed; wrapper exit0, normal admission0s, command40s, cleanup1s. Exact compose wsx-adc08fa06f4a78425d7c was independently confirmed absent. This is the targeted replay test justified by the real CI defect, not a repeat of PG8/HTTP/Next. Recovery suffix after actual precision merge also passes its two pure checks (`recovery-scope-after-precision.txt`).

Next normal hook/push and fresh CI are still required; previous local green never replaces CI, and the PR is not claimed complete or merge-ready.

## Project invitation issuer/acceptance lock cycle (PR thread PRRT_kwDOO5_Nyc6ylPEq)

Reviewed source 9001 introduced org-before-invitation acceptance locking, while project link reset/email preparation still held invitation rows before INSERT needed an organization FK key-share lock. New test-only baseline `caeab6c54d398e771f78b928de385bad5006beb1` reproduces both cycles on real PostgreSQL: issuer updates old invitation and pauses, acceptance starts, pg_blocking_pids confirms acceptance waits for issuer, issuer resumes its INSERT, PostgreSQL detects a deadlock. Both target cases failed because acceptance rejected with `deadlock detected`; this is a business-concurrency red, not fixture failure. Raw: project-lock-red.txt.

Applied exactly project-lock-fix.patch in the same owned wrapper: prepareEmailInvitations and issueLink acquire existing lockOrganizationCapacity before lockProject/expireStale/revoke/INSERT. The order is canonical epoch shared → organization row → project advisory → invitation/FK. Acceptance uses the compatible epoch/org → invitation subsequence; no extra token-side project read/lock was added. This changes no grants, roles, capacity calculation or invitation reservation. Resend/revoke do not subsequently acquire organization locks; token org_id_hint has no organization FK.

The exact test file SHA-256 was `5851d62a173ec4dacb9cd9119d5d898a16c3ac485ad1dbcef23da104fe219c07` before and after applying the source patch. All original 8 plus new 2 cases then passed (10/10, 29.51s total / 5.52s business tests), raw project-lock-green.txt. Tests verify issuer success, rejection of the old invitation, old revoked/expired state and one new pending invitation. They use actual database locks/connections; the observing DatabasePort wrappers delegate every SQL call to PostgreSQL.

One owned with-test-isolation wrapper, no full suite/Next/HTTP repeat. Admission0s, command3m41s, cleanup2s, total3m43s, exit0. Exact compose wsx-bb65ea93f06f9140ec7b independently checked with docker ps -a filter: no containers remained. Worker released the resource token immediately. Independent source review and normal CI remain required before resolving the review thread.
