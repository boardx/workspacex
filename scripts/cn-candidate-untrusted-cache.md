# Candidate untrusted-cache delivery v1

This opt-in protocol transports previously built candidate bytes. It does not
build images, extend an original receipt, authorize deployment, or establish an
immutable OSS archive. The strict v2 transport and its policy-fence requirement
remain unchanged.

## Approval and exact bytes

A separately approved request raw SHA binds all request bytes. The transport kind
is `approved-candidate-oss-untrusted-cache-v1`; its fields are the strict transport
fields plus `deliveryId`, generated with 16 cryptographically random bytes encoded
as 32 lowercase hex characters. Generation happens once before request approval.
It must not change the original build attempt.

The exact prefix is
`cn-image-candidates/<source>/<originalAttempt>/deliveries/<deliveryId>/`.
There are exactly seven objects: `candidate-plan.json`, `candidate-set.json`, and
`web.tar`, `api.tar`, `agent.tar`, `postgres.tar`, `sandbox.tar` as defined by the
canonical repository set (the implementation's `REPOSITORIES` is authoritative).
Each map entry contains exactly `key`, empty `versionId`, `sha256`, and `bytes`.
Their values must match original plan/set raw bytes and the five original receipt
entries; independently approved map hashes alone cannot substitute for this check.

The transfer approval kind is `cn-candidate-untrusted-cache-approval-v1`, with
`schemaVersion: 1`. It retains original source/control/attempt, candidate identity,
plan/set raw hashes, transport hash, operation and observed/expiry timestamps.
An explicitly admitted revalidation proof also binds `revalidationRawSha256`.
There is no versioning fence field, no fabricated fence, and no policy field.

The ECS request kind is `cn-candidate-authenticated-untrusted-cache-v1`. It retains
all strict authenticated request fields except `bucketPolicyRawSha256`,
`fenceStartsAt`, and `fenceExpiresAt`; those fields are rejected. Optional proof
and revalidation-policy raw hashes still occur together. The explicit consumer
requires both independently approved hashes and the unchanged protected admission
chain. Original receipt bytes and expiry never change; absent revalidation, an
expired original receipt still fails.

## Transfer and observation boundary

`UntrustedCacheTransfer` has the same constructor and bounded upload/download
interfaces as `CandidateTransfer`, including the optional admitted `revalidation`
capability. It shares private-file snapshots, five complete tar/config/layer
validation, full GET hashing, private FD download and Linux NOREPLACE publication.
The publisher subsequently verifies all bytes again under its own current gates.
Existing root host publication approval and dynamic authorization/epoch/backup
requirements are unchanged.

The native upload port sends each missing object in one PUT with
`x-oss-forbid-overwrite: true`, private ACL, and retry count zero. There is no
multipart or automatic retry in this protocol's native port. Only an actually
submitted PUT with an unknown outcome may raise `UnknownPutOutcome`; the core
then permits full GET verification, never a second PUT. Identity, version, scope,
or pre-dispatch failures must propagate immediately. Matching cached bytes do
not hide these failures.

Ports implement `observe_cache_version()` returning exactly `Disabled`. GET
readback observes this before and after reading all bytes. The final private
bundle verification observes it before download publication. Authentication uses
one existing credential snapshot for signed STS and OSS, exact account/instance/
role/region/bucket, private ACL and observed Disabled versioning. A failed signed
identity or version observation permanently invalidates that port instance.
No new path calls GetBucketPolicy, creates credentials, changes permissions,
changes versioning, or creates a bucket.

These observations **do not exclude an administrator changing bucket state
between reads**. `remoteCacheImmutable` and `administrativeRaceExcluded` remain
false. The security claim is verified local bytes under independently approved
hashes, not remote atomic immutability. If any observation fails, stop and review;
do not weaken checks or reuse an uncertain operation as an automatic retry.

## Offline verification

Run `python3 -I -B -m unittest discover -s tests -p 'test_cn_candidate_untrusted_cache.py' -v`.
Also run the existing OSS, authenticated SDK and revalidation suites. Linux CI
runs the actual private FD/NOREPLACE download test; macOS explicitly skips it.
Tests use fake provider ports and real five-tar parsing, with no cloud writes.
