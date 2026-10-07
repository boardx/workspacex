# Single release entry (offline draft)

`release-cn.yml` is the manual entry. Default `artifact-only` runs hosted artifact
validation, parallel builds, registry readback and seal. It never schedules the
protected production runner jobs.

`full-release` requires the main ref and an exact independently reviewed main-cn
baseline. Its order is:

1. Protected installed-tool byte comparison, live input checks and full real
   prebuild collection/verification under the canonical host lock.
2. Hosted artifact builds with the same parent run/attempt identity.
3. Protected import verifies the original prebuild is still valid, imports
   verified manifest/seal and collects fresh preactivate evidence. It does not
   refresh an expired prebuild. An expired build must restart from preflight.
4. Existing protected host prepare and complete promotion verifier.
5. Existing frozen-tag controller creates/verifies the protected annotated tag.
6. Dispatch the unchanged promotion workflow at that tag. Its native approval,
   activation, browser acceptance and main-cn transaction remain authoritative.

Dispatch acceptance is not deployment completion. The promotion run remains the
source of truth for its outcome. The parent preparation job releases the shared
GitHub concurrency group when dispatch finishes, allowing promotion to proceed.

Before full prebuild or hosted build, the application candidate must match all
nine installed entrypoints checked by the unchanged promotion workflow, plus
the reviewed frozen-tag and main-source-admission helpers. The old A1 application
candidate does not contain the new deployment import guard. Once the new guard
is installed, using old A1 bytes for full-release therefore fails this early
compatibility gate. A new reviewed application commit must contain the same
installed guard at its canonical repository path; compatibility is not waived.
Scratch patch paths describe the reviewed installation payload only. They do
not replace the candidate's canonical `.harness/scripts/vm/` paths in promotion.

The reusable build workflow declares `production-cn-build` on its own jobs. Its
ACR secrets come from that environment; the caller does not forward arbitrary
repository secrets. Missing environment configuration fails closed. No new IAM
or secret creation is included.

This detached review checkout integrates wrapper/deploy changes at canonical
`.harness/scripts/vm/` locations. Before enabling, install reviewed exact closures and
configuration, configure bounded sudo rules, confirm protected source/cache,
root-private per-attempt expected identity and original prebuild receipts, and
preserve native tag/environment governance. These capabilities have not been
proven installed by the offline tests.

Legacy `prepare-cn-release.yml` still runs after successful main backend gates.
Publishing or merging this branch to main can start that existing host build and
prepare path. This local commit does not enable publication; review that trigger
before any push or merge. Existing frontend main-push workflows also remain in
place and may run when their own path filters match.
