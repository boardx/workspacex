# Offline acquisition and publication templates

Only `scripts/cn-release-continuation-acquire.py` is a CLI. It reads root-owned
`/etc/workspacex-cn/continuation-approvals/<request-sha256>.json` using the existing
private approval reader. No caller-selected approval directory or approval flag
exists. No file here runs a cloud operation during generation.

The request fields are `schemaVersion: 1`, `phase: consume|publication`, exact
`sourceRevision`, `controlRevision`, `attemptId`, `repositoryId`, `runId`,
`runAttempt`, `producerWorkflowSha256`, original `requestedAt`, `deadlineAt`,
`inputs`, `release`, and `launcher`. The original window must be at most 30
minutes; revalidation must cover its full deadline. `inputs` maps names to exact
raw SHA256 values; files are supplied as `<name>.json`. Consume requires plan,
set, proof and policy; publication additionally requires tools, canonical,
provider, redis and binaries. Every file is limited to 1 MiB.

The protected approval has kind `cn-continuation-acquire-approval-v1`, the raw
`requestSha256`, `issuedAt`, `expiresAt`, and `templateFiles` mapping these four
names to exact SHA256: consumer.py, consume-launcher.py,
materialize-publication.py, stage-runtime.py. Approval installation is a separate
reviewed operation. A generated publisher approval is derived only after this
protected request is verified; it is not a new approval source.

The launcher object has `sdkSha256` and `code` (the eleven pinned original
launcher/SDK/admission dependencies). All code hashes must equal exact Git bytes
at the approved control. Generated runtime verifies installed owner, mode, SDK,
and code bytes again before calling the GET-only consumer under its original
Linux supervisor. The generated consumer uses the original canonical revalidation
and bundle verifier and promotes with the original lock/no-replace semantics.

Publication reuses the original canonical intent, host approval, immutable
provider, Redis, and tool validation. Its generated stage, check-plan and publish
commands retain the deadline in host approval. A publication request with less
than 20 minutes left is rejected by the existing materializer. No elapsed time
is reset. Binary evidence references inside the pinned binaries input remain
required and are checked by exact hash.

`provenance.json` records hashes of the pre-parameterization scripts. Generic
changes remove per-release source/control/run/attempt constants, retain fixed
Shanghai target and approved HK bucket, and constrain expiry to 30 minutes.

## Explicit remaining boundaries

- Canonical `cn_image_candidate.validate_plan` has a reviewed `FORMAL_SOURCES`
  allowlist. A new source outside it is rejected. This binder never bypasses or
  edits that canonical admission rule; an approved producer control must support
  that source first.
- The original consumer limits each ZIP to 2 GiB and all objects to less than
  5 GiB. Oversize inputs fail closed. Changing these limits requires a reviewed
  resource-budget change.
- Installed host capabilities, exact HK object permissions for a new run,
  package approval/install, and one authorized mutation executor are prerequisites.
  The generator does not configure them or report them as ready.
- Tests use synthetic local seven-ZIP archives and real canonical validators;
  they do not prove cloud execution, real image transfer or a 30-minute release.
