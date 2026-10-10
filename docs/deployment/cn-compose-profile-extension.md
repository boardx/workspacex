# Reviewed Compose profile extension v1 (implementation contract)

This optional extension does not expand the Git FILES install targets. Base profile
rows, installedTargets and installedFilesSha256 retain their exact existing meaning.
It adds only derived emitter source/dependency hashes, originalWriterPlan and the
strict candidateComposeEmitter capability. Existing consumers stay unchanged.

## Frozen wire schema

`composeExtensionV1` is a container with exactly `sha256` and `rawBase64`. Decoding
must produce canonical sorted JSON plus newline, at most 5,000,000 bytes, whose SHA256 matches
the independently supplied expected extension hash. JSON duplicate fields fail.
The decoded object has exactly:

- `schemaVersion: 1`, `kind: "cn-compose-profile-extension-v1"`, `toolRevision`.
- `originalWriterPlan`: exact protected `{path, sha256}`.
- `candidateComposeEmitter`: existing strict schemaVersion2 descriptor (path,
  sha256,nodePath,nodeSha256,sourceClosureRef,configRef,optionsRef,
  originalEntryPlanRef,dockerPath,dockerSha256,dockerSocket).
- `documents`: exactly `closure`, `writerPlan`, `entryPlan`, `manifest`, `config`,
  `options`, `emitter`; each is `{path, sha256, rawBase64}`. No arbitrary documents.
- `inputs`: map of source-relative paths to `{sha256, rawBase64}`. Its keys must
  equal the schema2 closure sources, dependencies, and `pnpm-lock.yaml`; no extras.

All document refs equal the capability/plan/options refs that consume them.
Their raw bytes, hashes, shared identity, source, tool, release and original-plan
pin are checked. Manifest requires exactly six canonical digest image entries;
config.provision.release must equal its release. Writer and entry plan must carry
actual explicit authorization, never an inferred boolean. Old expiry/epoch gates
remain the responsibility of the unchanged live consumers.

Every source input must equal the exact tool Git blob, and the six native APP
sources must also equal the approved APP Git blobs. Dependency bytes equal the
actual generated closure pins; lockfile equals exact tool Git. Dependencies and
bundle are independently reviewed build output, not made trustworthy merely by
an internally matching hash: the root operator supplies the extension raw hash
independently of the install manifest after reviewing the actual compiler/source
provenance. No `trusted: true` flag or arbitrary extra-file map exists.

The producer accepts an explicit `--compose-extension PATH EXPECTED_SHA` option.
The installer accepts an explicit `--compose-extension EXPECTED_SHA` option,
including reviewed recovery. Missing, unsolicited, or mismatched pins fail. The
installer rechecks the protected documents already staged on the host with the
exact owner/mode/single-link/no-symlink rules before creating the profile transaction.
It stages no emitter, plans, configuration or credentials itself.

The resulting protected profile contains a **different**, compact schema under
`composeExtensionV1`: exactly `schemaVersion:1`,
`kind:"cn-compose-profile-projection-v1"`, `extensionSha256`, and `evidence`.
`evidence` is a mechanical projection of the full validated extension: input
entries retain only `sha256`, and the emitter document retains only its path and
hash. Other small documents retain their raw bytes. The profile also retains
`composeBaseFilesSha256`, exactly the base FILES map. This avoids embedding the
full compiler input bytes in every runtime profile read.

New admission never accepts a compact projection in place of the full extension.
`validate_compose_extension` validates full bytes and the independent root hash;
`validate_compose_projection` is a distinct API exclusively for an already
installed profile authenticated by protected inventory and the independently
pinned provider receipt. The old projection's `extensionSha256` records earlier
approval; it does not self-authenticate new approval. Old dependency pins retain
that previous root approval, **not** a new claim that the original build ran.

Old base FILES is still compared to the exact old Git allowlist. Old source and
lockfile bytes are rechecked against old Git (including the six APP source
matches), and the entire compact capability is rebuilt using the old Git schema.
Removing an existing extension by omitting the new option is rejected; this PR
provides no implicit capability-removal protocol. No-extension compatibility has
a frozen golden test and an independent local comparison against the base schema.

Negative tests cover absent/wrong independent pin, duplicate/extra fields, source
or dependency drift, native source mismatch, unexpected input paths, base-pin
conflict, wrong original plan/hash/pair/authorization, manifest/source/release
mismatch, wrong config/options refs, changed root-staged bytes, and old-profile
extension tampering. Fixture approval flags do not authorize any live operation.

Profile content is explicitly bounded to 1,048,576 bytes, retaining the smallest
existing runtime reader limit (fixed_transport.ts); those consumers are unchanged.
Manifest and inventory-evidence reads explicitly allow 32,000,000 bytes because
they embed old and new profile evidence; ordinary transaction reads retain their
8,000,000-byte limit. Executable verification streams at most 256,000,000 bytes.

## Explicit local package and root install entry points

Append `--compose-extension /absolute/full-extension.json EXPECTED_RAW_SHA256`
to the existing producer invocation. Append `--compose-extension EXPECTED_RAW_SHA256`
to the existing root installer invocation (or after its reviewed recovery args).
A missing pin, an unsolicited pin, or a pin inconsistent with any full bytes fails.
The optional input does not authorize installation; existing root lock, trusted
Git, provider receipt freshness, old metadata, transaction and recovery checks
remain required. The manifest carries the full evidence, the profile only the
compact projection. Emission does not stage any referenced file or execute code.

The operator must pre-stage the seven fixed documents at their approved protected
paths, root:root, single link, mode0600 except the emitter mode0700. The installer
reads them again through protected FDs and compares complete bytes; it also hashes
root:root mode0755 Node/Docker through bounded streaming FDs. The emitter Node pin
must equal the independently captured maintenance Node inventory pin.
No production plan, manifest, valid approval, or emitter execution is supplied by
this change. Release identity generation uses the existing release-pair source.
