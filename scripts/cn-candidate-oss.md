# Candidate v2 OSS transfer (Refs #5547)

`cn_candidate_oss.CandidateTransfer` is a credential-free internal library.
It does not discover a bucket, obtain credentials, install tools, expose a CLI,
or dispatch a cloud operation. An independently admitted caller supplies the
OSS port, original plan/set bytes and hashes, exact transport, and bound approval.
The legacy v1 adapter and protocol remain unchanged.

The v2 namespace is `cn-image-candidates/<sourceRevision>/<attemptId>/`.
Its exact object set is `candidate-plan.json`, `candidate-set.json` and the five
service tar files. All keys and hashes are bound in the transport. Only Shanghai
HTTPS OSS is admitted; version IDs must be empty. Upload verifies private pinned
snapshots and every candidate tar before any remote write. Five tar files and the
original plan are read back in full before the original candidate set is published
as the completion marker. Unknown PUT acknowledgement permits readback only.
Download stages private files and verifies the complete candidate before Linux
`renameat2(RENAME_NOREPLACE)` publishes the directory.

The original one-hour candidate expiry is checked throughout transfer and is
preserved in the result. A transfer approval cannot extend it. The original plan
bytes need not be canonical JSON, but their original hash must match the candidate
receipt; the transport never rewrites either original document. GitHub artifact
retention does not extend candidate validity.

A `versioningFenceProofSha256` binds independently collected evidence, not a
boolean claim that this library authenticates. The shared `OssSdkPort` checks the
supplied bucket/principal/endpoint binding, timeout and disabled versioning. The
caller still must prove the real principal and its permitted scope, private ACL,
no-overwrite policy and protection against concurrent versioning changes.
Existing bucket discovery, a 404 policy response, or a string principal alone is
not that proof. No new bucket, credential, permission or policy is authorized by
this library. `authenticatedPrincipalProven`, `releaseReady`, `productionReady`
remain false. Actual host tool installation, canonical publication and production
activation are separate gates.

Tests use real synthetic Docker-save bytes and a fake OSS port. Run:

```sh
python3 -m unittest discover -s tests -p test_cn_candidate_oss.py -v
```

The full download/no-replace test requires Linux (`/proc/self/fd`, `renameat2`)
and is explicitly skipped on macOS. Real OSS authentication and cloud transfer
are not covered by these local tests.
