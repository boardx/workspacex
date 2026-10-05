# Step 2 — fixed tool package precheck and installation boundary

Scope: source development and isolated tests only. The fixed application remains
`9b25bfa65662b96c0826fe67506b562ea46aa6d0`, baseline
`ba6343199f3c834d6a198f83d0c771614292c82b`, release `2026.10.3-cn.1`.
These application release pins belong to the release manifest; the installation
package binds its application and operational tool revisions separately.

## Inputs and outputs

Existing `prepare-cn-tool-install.py --review-package REPO TOOL APP MAIN INVENTORY OUTPUT`
produces the exact Git-backed review package. It does not install files.
The new local consumer is:

```sh
python3 .harness/scripts/vm/precheck-cn-tool-install.py \
  --review-package REPO PACKAGE MANIFEST_SHA256 TOOL_SHA APP_SHA MAIN_SHA
```

Supply independently frozen exact SHA/hash arguments. This reads the COMPLETE
marker, pinned manifest and complete payload, checks FILES/target authority from
exact tool Git source, matches payload bytes to those Git blobs, and verifies
local Git metadata remained unchanged during the check. A passing JSON only says
`packageIntegrityVerified=true`; `ready`, `installed` and
`installationAuthorized` remain false. It does not qualify baseline schema,
provider evidence, profile admission, root host trust or installation permission.
Errors return exit 1 and a stable redacted stderr code, with no success stdout.

## Idempotence, failures and rollback

Byte-identical repeat checks produce identical output and do not change package
files. Wrong pins, incomplete packages, extra files, symlinks, foreign bytes,
modified target mappings, swapped revisions or an elevated ready flag fail closed.
The precheck has no host transport or mutation, so it requires no rollback.
Actual installation continues through the existing root-private, FD 9 locked
`cn-tool-install-transaction.py` protocol, including full inventory/provider/profile
revalidation, old-identity CAS, durable journal and exact reviewed recovery pins.
Never route this local receipt directly to that executor as host admission.

## Stage boundary

The existing default `prebuild` path and trusted `artifact-build` path remain
unchanged. Artifact-only evidence does not qualify migration or activation.
Prepare → collector → verifier → publisher failclosed testing is owned by the
shared integration tests. This new precheck is a developer review tool and does
not expand the production FILES closure or install another runtime command.

## Local evidence and remaining backlog

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .harness/scripts/vm -p 'precheck_cn_tool_install_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .harness/scripts/vm -p 'prepare_cn_tool_install_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .harness/scripts/vm -p 'cn_tool_install_transaction_test.py'
```

On 2026-10-04 UTC: new precheck 3 tests (10 mutation subcases), producer 16 tests,
transaction installer 12 tests passed. These are synthetic local fixtures;
no fixed release package or production host was installed. After final source
integration the final source/target closure must be re-frozen by the integration
writer. Actual host inventory capture, exact root Git packaging, installation
approval and host validation remain separate future work. Qualified baseline
replay remains paused and is not required to check an artifact-only build.
