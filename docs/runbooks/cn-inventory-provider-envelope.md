# Cloud Assistant inventory output envelope

Cloud Assistant `DescribeInvocationResults` truncates output past 24 KB (`Dropped`). Even 132 entirely absent tool entries exceed that limit. A truncated capture cannot authorize installation.

The existing raw JSON protocol remains supported unchanged: canonical remote inventory JSON is `json.dumps(remote, sort_keys=True) + '\n'`; `sourceInvocation` is added only to the locally captured inventory. Raw receipts may explicitly specify `outputEncoding: raw-json-v1`, but must not carry compressed-only fields.

The additional protocol is selected **only** by receipt `outputEncoding: gzip-base64-inventory-v1`. The actual remote stdout is a canonical JSON envelope with exactly:

- `schemaVersion`: integer `1`
- `kind`: `cn-tool-inventory-gzip-base64-v1`
- `decodedBytes`: exact canonical remote inventory byte length
- `decodedSha256`: SHA-256 of those bytes
- `gzipBase64`: canonical Base64 of one complete gzip member containing those bytes

The externally captured provider receipt retains the same actual instance, region, command, invocation, success, exit code, dropped-byte, timestamp, and read-only evidence. It additionally contains `outputBase64` (the **actual wire stdout bytes**, Base64 encoded) and `decodedInventorySha256`. `outputSha256` now binds actual wire bytes, never a substituted decoded output. Existing `localInventorySha256` binds the local inventory including the actual `sourceInvocation`. The producer and installer both verify wire hash, envelope, decoded hash, and exact equality to the reconstructed inventory. The receipt itself remains an externally pinned root capture, not authentication manufactured by a local hash.

Limits: wire <=24,000 bytes; gzip <=18,000 bytes; decoded <=1 MiB; expansion <=128 times compressed size. Base64 must be canonical. All JSON duplicate keys and nonfinite constants are rejected. Inflating is output-bounded; truncated streams, trailing bytes, concatenated gzip members, false sizes, changed hashes, and ambiguous raw/compressed receipts fail closed. Invocation identity, observed time, freshness, root-capture provenance, and installed-file trust checks are not relaxed.

Capture workflow:

1. Review the exact collector, final control FILES/schema pins, fixed target and command hash. Run the collector once under the canonical read-only release lock.
2. Require actual provider Success, ExitCode 0, Dropped 0, root username, exact instance/invocation/command and matching command content. Save the original wire output and provider receipt. Do not execute output as code.
3. Decode the bounded envelope and validate its canonical inventory bytes. Add only the actual `sourceInvocation` locally. Preserve all profile, file, absence, and metadata rows.
4. Construct and independently pin the capture receipt with both hashes and original wire bytes. Feed it to the normal reviewed-package producer; the installation consumer repeats verification.

This change does not authorize cloud execution, installation, profile creation, or production activation. Never label decoded stdout as if it were the raw provider output of the legacy protocol.

Official output limit: https://help.aliyun.com/zh/ecs/developer-reference/api-ecs-2014-05-26-describeinvocationresults (Dropped response field).

## One snapshot, multiple provider receipts

The actual 88,145-byte inventory exceeded the single-wire bound even with compression: gzip 22,127 bytes / wire 29,695; bz2 19,277 / 25,893; XZ 19,840 / 26,643. The single-gzip protocol remains supported but was not usable for this production capture.

`gzip-base64-inventory-parts-v1` therefore explicitly supports **one immutable snapshot**, never concatenated independent live samples. The collector holds the existing canonical shared release lock through collection and snapshot publication. Under `/var/lib/workspacex-cn/tool-inventory-snapshots/<32-hex-id>`, it exclusively creates a root0700 directory, root0600 single-link `inventory.json.gz`, then `manifest.json` last. It neither overwrites an existing snapshot nor changes application files. The manifest's original observation time, original decoded length/hash, compressed length/hash, chunk size 12,288 and count bind the entire snapshot. These protected metadata writes are disclosed: the capture receipt must set `readOnly: false`, `snapshotWritesOnly: true`, `productionModified: false`, and `username: root`. The inventory describes read-only source observation; existing raw/single-gzip captures still require their original read-only gate.

Each later fixed read command checks the root-private manifest and whole compressed file through nofollow, single-link FDs, with exact sizes, hashes and stable identities. It emits one canonical part envelope containing the capture manifest hash, snapshot ID, integer index/count/offset/size, chunk hash and Base64. Each wire remains <=24,000 bytes. Snapshot compressed size is <=65,536 bytes (at most six parts); the decoded size and ratio caps remain 1 MiB and 128. No automatic retry, overwrite, deletion, or collection occurs in a part read. Failed/unknown capture requires reconciliation of the existing snapshot, not another capture under the same ID.

The top receipt retains the **actual capture manifest stdout** in `outputBase64` and its actual wire `outputSha256`; `decodedInventorySha256` binds the reconstructed inventory. `parts` is an ordered list of independently captured provider receipts, each with exact part index, actual invocation/command/region/instance, root username, read-only status, terminal Success/ExitCode 0/Dropped 0, actual start/finish times, and actual wire output/hash. The externally approved `expected` object adds an ordered `partBindings` list of `{partIndex, sourceInvocation, commandId}`. Expected identities must come from the independently reviewed dispatch/capture evidence, never be copied from untrusted receipt fields.

Both preparation and installation consumers verify every part provider identity against those expected bindings, reject repeated/missing/reordered identities or parts, bind all parts to the one capture manifest, reassemble and verify the complete gzip hash, then perform output-bounded single-member decompression and verify the exact original inventory bytes/hash. The original capture `observedAt` and start time remain subject to the original TTL; later successful part reads never refresh it. Each part must start after capture completion and finish before validation time. The capture's exact reviewed command/source remains the external authority for its metadata-only write scope; a Boolean flag alone is not evidence of that scope.

After all provider checks, add only the actual capture invocation ID to the local reconstructed inventory. Preserve all 132 entries, the protected profile's original bytes, and all present/absent and metadata fields. No proof is fabricated by merging snapshots or by normalizing provider wire bytes before hashing.
