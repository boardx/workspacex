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
