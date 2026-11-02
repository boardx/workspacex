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

Signed design PR #6101 is now normally merged into develop `6ed5e6833`. This branch replays only its 25 #6107 commits onto that base: `develop-replay-range-diff.txt` shows all 25 patch-equivalent (`=`), and excludes all 18 old design commits. Every capacity source/test/schema/contract/recovery file is byte-identical to reviewed old HEAD `98fceafbc`; no #6111/#6120 or financial migration is included. Old source is preserved locally at `archive/team-capacity-6107-reviewed-98f`; #6111 remains on its separate branch. Root explicitly accepted the unchanged-source replay and requires no duplicate PG/HTTP/Next run.

Normal serial pre-push/static checks, separate Closes #6107 PR and CI remain pending at this record. No passing state, merge, sales activation or deployment is claimed. Runtime evidence above comes from the unchanged reviewed source. Full API typecheck was previously terminated for resource contention; this replay will use the normal hook rather than treating targeted tests as static proof.

## Normal hook internal-admission boundary follow-up

First normal serial pre-push stopped at `lint-permission-paths` (22/25 successful, push did not occur): the new internal capacity decision helper was treated as raw tenant-content disclosure. No runtime source, query or permission decision changed to address this. A single-file AST boundary now checks its exact seven scoped SQL statements, bound org/epoch parameters, five internal exports, closed projection/boolean returns, dependencies/calls, and forbids interface/application imports or infrastructure re-export. It requires the pure mutation tests and existing real PG/HTTP evidence files; the general tenant read rule is unchanged and no blanket allowlist/dummy guard was added.

`admission-boundary-pure.txt`: 12 pure cases passed, including counterexamples for raw rows, unscoped/wrong-tenant SQL, extra tenant content, logging/disclosure calls, extra exports, direct external imports and re-export. `permission-boundary-lint.txt`: actual full permission-path scan passed (2203 files/325 tenant tables). These are static gates only, not an additional runtime claim. Normal hook retry remains required after independent review.
