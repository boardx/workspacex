# Organization commercial capacity — #6107

Baseline: `fc12ccb98` (canonical schema/helper and corrected real-PG tests; no member entry integration).
Design dependency: `8e07cd7d82c6491f3d8a91431f0f8ca805ec4257`, merged locally explicitly; business PR targets develop after dependency integration.

## Current evidence

- `init.txt`: isolated worktree bootstrap exited 0.
- Pure capacity tests: 6 passed, including purchased 5 / pending 7 remaining 5 and mechanical migration-floor comparison against `TEAM_INCLUDED_SEATS`.
- `pg-fixture-failure.txt`: first real-PG attempt waited 265 seconds for normal resource admission, migrated the real schema and failed on an invalid fixture role. It did **not** exercise the capacity assertions and is **not** a capacity counterexample. Fixture correction is committed in baseline above. Owned compose stack was automatically removed.
- API typecheck was deliberately terminated during machine contention; no passing claim.
- `harness tick` failed because `COORD_GATEWAY_URL` is not configured; task authority is the parent's explicit #6107 delegation.

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

`org_commercial_licenses` stores generation and purchased / pending seats, with pending purchase reference paired. Plan/Enterprise identity remains exclusively in `organization_plans.plan` and its `billing_generation`. Current generation and epoch activation reuse the existing billing authority. License and admission mutations lock epoch shared → organization row → plan/license → wallet. With paid seats, pending additions do not increase usable capacity. Legacy organizations retain their prior quota policy. Commercial invitations do not reserve seats.

## Remaining work

Correct-fixture PG baseline red → apply member-entry patch → identical test green → expand cross-entry/role/rollback regressions and HTTP evidence → independent exact-SHA security/feature review → separate PR and normal CI. Nothing in this evidence marks the feature passing or enables Team sales.
