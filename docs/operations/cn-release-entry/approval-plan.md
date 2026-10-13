# Offline complete request and installation proposal

`cn-release-approval-plan.py` generates the **complete** root release JSON,
versioned code inventory, all 17 observer/verifier contract hashes rendered for
that exact installed directory, and a byte-size report. It performs no install,
cloud call, approval, or production readiness claim. It rejects a full request
above the existing 65,536-byte entry limit; RDS uses the bounded fixed private SDK
manifest reference rather than an inline file inventory.

```sh
python3 scripts/cn-release-approval-plan.py \
  --parameters /absolute/path/release-parameters.json \
  --probe /absolute/path/fresh-host-readonly-output.json \
  --output /absolute/path/new-review-directory
```

The output directory must not exist. Output files are `approval.json`,
`installation-plan.json`, and `size-report.json`, each mode 0600. This local
proposal is not accepted as installed root authorization. Review the exact raw
hash and fresh host CAS before separately approving installation. The builder
checks original timestamps at `issuedAt` for schema consistency only; runtime
admission still uses the actual clock and real provider/host capabilities.

The parameter object has exactly these fields:

| Field | Required evidence |
| --- | --- |
| `identity` | Original source, baseline, control, publication attempt, runtime attempt, requestedAt and deadlineAt. Never move the original clock. |
| `target` | Fixed account, Shanghai region and specified ECS. |
| `issuedAt`, `expiresAt` | Original scoped release authorization window. |
| `acquireRequests` | Both actual consume/publication request objects from the reviewed acquire protocol, including original plan/set/proof/policy hashes and fixed repository/run/artifact identities. Expired proof must be independently revalidated. |
| `runtimeStaticInputHashes` | Actual original bytes of authorization, template and migrationDiff, available in the fixed release-input directory. |
| `runtimeRoot` | Exact root-owned `upgrade-f0eb-*` directory, checked against current host state. |
| `business` | Fixed runtime profile SHA, candidate and baseline private browser-plan/test-scope SHAs, and 30–300-second stable observation window. Obtain hashes without exporting secret contents. |
| `rds` | Fixed dbInstanceId/roleName/sdkRoot, exact principalArn, sdkManifestSha256, holdHelperSha256, and original permissionEvidence path/SHA. Actual permission and provider readback are still required. `adapterSha256` is generated from this code closure. |

Target read-only evidence still needed before final approval: fresh old file
hashes/absence for every install target; actual Linux SDK manifest and complete
file closure; runtime executable/browser-tree inventory; private plans/scopes
and hash-only verification; exact role principal and separately approved RDS
CreateBackup/DescribeBackups/DescribeBackupTasks scope; cgroup availability; hold
helper hash/current generation; installed canonical control checkout; current
free space and publication proof lifetime. No credentials or browser-plan secret
bytes should be copied into this proposal or CI artifacts.

A complete local fixture with 52 code files measured **18,268 bytes**, including
both acquire requests, all 17 route hashes and external manifest/profile
references. Provider identities in that fixture are synthetic. This proves the
builder measures and enforces the full request, not that a final real production
request has been assembled or admitted. Re-run after every code or parameter
change; versioned paths and contract hashes change together.

The build has five images (`api`, `web`, `agent`, `sandbox`, `postgres`). The runtime
switch has five services (`api`, `web`, `agent`, `sandbox`, `sandbox-sessions`);
the latter reuses the sandbox image, and PostgreSQL is not recreated by this
runtime-only switch. Ordinary no-migration and urgent hotfix releases retain the
same safety gates. Pages, web-only/config-only, migrations and external prepared
receipt reuse are not alternative executable branches of this fixed driver.
