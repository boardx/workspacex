# Cloud profile implementation handoff — #3414

## Completed in this change

Shared Starter/production input schema, safe aggregate validation, illustrative examples,
generated JSON Schema with drift check, and a root `deploy:config` CLI entry point.
This is the first configuration slice of CP-01, not completion of prepare/provision.

## Verification

- `./init.sh`: passed on isolated checkout based on main `4140b3b57`.
- `pnpm --filter @repo/cloud-deploy build`: passed.
- `pnpm --filter @repo/cloud-deploy lint`: passed (typecheck + schema drift).
- `pnpm --filter @repo/cloud-deploy test`: 28 passed, including CLI subprocess tests.
- Root CLI generated and validated both examples successfully; `cloudVerified` remained false.
- `git diff --check`: passed.

The initial tests failed because the implementation did not exist. A root CLI entry was added
after actual command execution exposed `pnpm --filter` working-directory behavior.
No Docker stacks, production connections or cloud resources were created.

## Pending

- Cloud credential resolution, identity/resource/network and image preflight.
- Prepared-environment artifact and total 300-second provision runner.
- OSS runtime adapter and complete business file flows, RDS/Redis initialization,
  production Agent/sandbox images and live cloud evidence.
- Publish/CI/merge tracked by the linked issue and PR; no feature status was changed.

`harness readiness` was read. This user-assigned deployment change is outside the existing
queue and is tracked as an ad-hoc change in #3414. `harness tick` could not run because
`COORD_GATEWAY_URL` was not configured in this isolated checkout; no coordinator identity,
lease or passing status was fabricated.
