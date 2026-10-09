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

Dispatch acceptance is not deployment completion. A separate hosted terminal job
correlates the new promotion run and requires its deployment, original acceptance
and main-cn result to succeed; it never holds the downstream production lock.
The promotion run remains the source of truth for its outcome. The parent preparation job releases the shared
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
configuration comes from that environment; the caller does not forward arbitrary
repository secrets. Missing configuration fails closed. No IAM, network, paid
resource or credential changes are performed by this code PR.

Registry edition must be explicitly configured. Personal edition uses protected
`WSX_ACR_USERNAME` and `WSX_ACR_PASSWORD`; it does not call GetAuthorizationToken
or pretend to provide a credential-free flow. Enterprise edition verifies the
actual GitHub OIDC subject before the pinned official configure action exchanges
it for STS credentials and requests temporary ACR credentials. Only authentication
jobs receive `id-token: write`. No token is an artifact or workflow output.

Required nonsecret environment configuration: `WSX_ACR_EDITION` (personal or
enterprise), `WSX_ACR_REGION` (cn-hongkong), `WSX_ACR_REGISTRY` (exact hostname),
`WSX_REGISTRY_PREFIX`, immutable `WSX_ACR_PROBE_IMAGE`, the four pinned base images,
and reviewed canonical control configuration plus SHA256. Enterprise additionally
requires `WSX_ACR_INSTANCE_ID`, `WSX_ALIYUN_ROLE_ARN`,
`WSX_ALIYUN_OIDC_PROVIDER_ARN`, and `WSX_ALIYUN_OIDC_SUBJECT`. Audience is explicitly
`sts.aliyuncs.com`. Configure the actual observed subject, including environment
or immutable owner/repository identifiers when present; never infer it from an
old example. RAM trust must independently enforce that exact subject and issuer.

The manual artifact-only default performs registry writes when explicitly
started, but never schedules production preparation or activation. There is no
new push, pull_request, workflow_run or automatic production trigger. Full-release
requires main, an explicit mode and reviewed baseline plus every original gate.
Public GitHub-to-Hong Kong upload and Shanghai-to-Hong Kong pull connectivity,
actual authentication and three-database qualification remain real-world checks;
isolated tests cannot satisfy them.

This detached review checkout integrates wrapper/deploy changes at canonical
`.harness/scripts/vm/` locations. Before enabling, install reviewed exact closures and
configuration, configure bounded sudo rules, confirm protected source/cache,
root-private per-attempt expected identity and original prebuild receipts, and
preserve native tag/environment governance. These capabilities have not been
proven installed by the offline tests.

This draft removes the legacy `prepare-cn-release.yml` automatic backend-gates
entry: only manual dispatch at main can schedule preparation, and both privileged
steps recheck event/ref before commands. Until a separately reviewed guard-only
change is merged, live main still retains the old automatic path. Publishing this
Draft branch runs PR CI; merging main can still trigger existing Devapp deployment.
Production locking serializes attempts but does not establish idempotence.
See `docs/verification/cloud-release-oidc/manual-prepare-gate.md` for the first
safe merge plan; this task does not merge or dispatch.

Personal edition is supported only for artifact-only producer validation, upload
and sealing. Full-release fails in the hosted input gate before any production
runner job unless the configured edition is enterprise: the existing protected
consumer protocol requires a genuine enterprise InstanceId. No invented instance
ID or weaker production handoff schema is allowed. Full personal deployment would
require a separately reviewed consumer protocol change.

The frozen application ee7e682805c27a38e9fd601c4aca66f11763ba91 does not match
the new installed deployment control bytes. It remains a build candidate, not an
eligible full-release candidate after these tools are installed. A reviewed
application commit containing matching canonical control files is required.

## Exact frozen candidate compatibility

Candidate `ee7e682805c27a38e9fd601c4aca66f11763ba91` has deployment entrypoint SHA256 `a5d9bc982e7f8cf2838dbf9f70ed341cbb772b0a4297817d8ed7440c2c648f7d`; this reviewed draft has `d9ca148615a6ca8d3daf87076b0234b619c4ef964d83fe1b6e3441f13641ec10`. This PR includes the required hosted-import guard and restored-baseline browser verification. Full release therefore requires a separately approved candidate revision containing these exact reviewed entrypoint bytes and a separately authorized matching tool installation. The fixed ee7 identity must not be relabeled or passed by bypassing equality. See `docs/verification/cloud-release-oidc/evidence.json` for commands and remaining live gates.
