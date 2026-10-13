# Historical candidate byte revalidation (Refs #5547)

The default v2 receipt/collector/transfer/publication path still rejects expired
receipts. This explicit protocol can reuse original artifacts after a complete
new verification. It neither edits the old receipt nor authorizes a production
operation. No build, artifact upload, credential creation or cloud write occurs.

## Trust chain and runnable producer

An independently reviewed policy fixes the repository numeric ID, exact successful
producer run and attempt, original control SHA and workflow SHA256, all seven
immutable artifact IDs, original plan/set raw hashes, verifier revision/full
seven-file closure, exact gh binary bytes, purpose, target ECS, verification ID
and a validity window of at most one hour. The policy is private to the executing
user. Its expected SHA must come from that independent review; calculating a hash
of arbitrary caller input is not admission. `validate_policy` is the field source.

Use an existing authenticated gh installation, with its real resolved executable
path and hash. No token is placed in argv or output. No authentication fallback,
new installation or automatic retry is supplied.

```sh
python3 -I -S -B /absolute/reviewed/scripts/revalidate-cn-image-candidates.py \
  /absolute/private-directory/policy.json APPROVED_POLICY_SHA256 \
  /absolute/private-directory
```

The entry checks isolated/no-site/no-bytecode mode. Before any repository module
is imported, it pins and verifies the complete closure, including the dynamic
`hosted-release.py` → `canonical_control.py` import, into a private snapshot.
The gh executable is similarly copied from verified bytes before execution.
The fixed authenticated GitHub API endpoints check actual run/attempt/repository,
main/manual workflow identity, success, exact workflow source bytes, artifact IDs,
provider archive SHA256 and sizes. In the original direct-download mode, seven ZIPs are fetched: plan, collection metadata
and five service payloads (each already contains its own original fragment/plan).
No duplicate metadata artifact downloads are required.

ZIP extraction accepts only the exact expected flat ordinary files. It rejects
links, duplicate/extra paths, encrypted files and inflated sizes. All five saved
image configs, labels, full layer bytes/diff IDs, sizes and SHA256 are rechecked.
All fragments must match the original plan and collected entries; collection
producedAt/expiresAt must equal the original fragment minima. No caller-supplied
`now` or refreshed collector is involved. The proof's observation time is sampled
after verification. Proof expiry is capped by both one hour and policy expiry.

The private output is published atomically with no replacement (`renameat2` on
Linux, `renameatx_np` on macOS). It preserves provider ZIPs, normalized provider
metadata snapshots, original fragment/plan/set bytes, verified flat bundle and
`candidate-revalidation.json`. Original evidence hashes and expired-at time remain
separate from the new verification time/expiry. A failure produces no completed
output and does not retry; failures after publication preserve the existing output.

## Explicit consumers

`cn_candidate_revalidation.admit(proof_raw, approved_proof_sha,
approved_policy_sha, policy_raw)` checks both independent hashes, the complete
policy/proof correspondence, verifier closure/revision, provider IDs and current
validity. The returned internal capability checks the original candidate binding
and re-verifies actual tar bytes. It is not a serialized `trusted=true` switch.

The proof SHA must be independently admitted after inspecting the actual producer
result. A proof and a hash supplied together by an untrusted party do not establish
trust. The local user's protected output is not automatically a root-approved
production artifact.

- `CandidateTransfer(..., revalidation=cap)` additionally requires that same proof
  hash in its independently approved transfer fields. Its current authorization,
  target, principal and versioning-fence checks remain mandatory.
- `publish(..., revalidation=cap)` requires the proof hash in the publication
  intent; every mutation checks the capability and existing adapter validity.
  Redis authentication/readback still precedes all candidate mutations.
- The root host entry accepts a separate
  `cn-candidate-host-revalidated-approval-v1` (schema 1), adding
  `revalidationRawSha256` and `revalidationPolicyRawSha256`. It reads root-private
  `candidate-revalidation.json` and `candidate-revalidation-policy.json` from the
  original source/build-attempt approval directory. Its installed closure adds
  `cn_candidate_revalidation.py`. Old approval kinds retain their original fields
  and strict expiry behavior. Source, original attempt and canonical paths do not
  change. The canonical receipt records both original expiry and new proof binding.

The seven-step release still needs fresh host/registry authorization, Redis
readback, baseline and lock, epoch/backup/recovery, Devapp/business acceptance and
separate writer approval. Neither a new proof nor old successful builds satisfy
those gates. `releaseReady` and `productionReady` remain false.

## Validation boundary

`test_cn_candidate_revalidation.py` uses real synthetic ZIP/Docker-save bytes and
an isolated subprocess with a fixture gh executable. It exercises full producer
and consumers without cloud access. Existing default receipt, publication, host
and OSS tests remain applicable. Real GitHub download, production installation and
cloud delivery require independently reviewed execution; local tests do not prove
those occurred.


## Explicit two-stage byte acquisition and cached verification

A slow network must not consume or silently extend a verification policy. The
new `--acquire` operation has a separate, independently reviewed request raw SHA.
It only obtains untrusted ZIP bytes; it has no revalidation policy, proof or
production authority. The request fixes `selection` (repository/run/attempt,
control/workflow, all seven IDs and original plan/set hashes), provider ZIP hashes
and exact sizes, gh executable, the same seven-file verifier closure and revision,
new acquisition ID, maximum four workers and at most 14,400 seconds of resource
budget. This budget is **not** a receipt/proof TTL. `validate_acquisition` is the
exact schema. No new permission, credentials, upload or retry is involved.

`previousDownloadStopped=true` and `networkAcquisitionAuthorized=true` are the
reviewer's explicit execution decision, not observations produced by this tool.
Before issuing that request, the coordinator must stop/account for the old
operation and all its child downloads. An existing `provider.zip`, even empty,
is conservatively classified as already started. Already-started incomplete
objects must be handled explicitly; they are not automatically retried.
`reusePaths` only admits complete private files with exactly pinned size and SHA.
They are fully checked before any new large GET begins, and never receive a GET
or fallback. Remaining objects get one bounded authenticated GET each. Every
object has fresh provider metadata before and after acquisition. Failed objects
remain `.partial`; complete objects are sealed without replacement. A failed
batch never emits an acquisition manifest or proof. The coordinator may separately
review completed ZIPs for adoption by a later request.

```sh
python3 -I -S -B /absolute/reviewed/scripts/revalidate-cn-image-candidates.py \
  --acquire /absolute/private/acquisition-request.json APPROVED_REQUEST_SHA256 \
  /absolute/private
```

After all seven original ZIPs exist, review their acquisition manifest and its
raw SHA. Only then issue a **new** independent verification policy, with its own
ordinary one-hour window and the exact newly reviewed verifier revision/closure.
The previous policy is neither changed nor extended. Use the explicit entry:

```sh
python3 -I -S -B /absolute/reviewed/scripts/revalidate-cn-image-candidates.py \
  /absolute/private/new-policy.json APPROVED_NEW_POLICY_SHA256 /absolute/private \
  --cached /absolute/cache/acquisition-manifest.json APPROVED_MANIFEST_SHA256
```

Cached verification does not claim a fresh network download. The protected
manifest selects untrusted byte inputs; it cannot establish provider authority.
Only the exact seven ZIP endpoints use those private, non-linked FD snapshots.
Missing, changed, corrupt, extra or symlinked inputs fail without a network
fallback. Fresh authenticated GitHub run/attempt/workflow/artifact observations
precede the normal complete ZIP hash, safe extraction, original plan/set/fragment,
and all five tar/config/layer validations. All nine provider metadata snapshots
are authenticated again afterward and must be exactly unchanged, with artifacts
still unexpired. A benign metadata change also fails conservatively.

`verifiedStartedAt` and `verifiedAt` describe this real fresh validation, not
acquisition timestamps. The existing v1 proof schema makes no fresh-download-time
claim; its field meanings, consumer checks and one-hour limits remain unchanged.
The actual new producer code is independently pinned by verifier revision and
seven hashes. Its additional `cache-verification-observation.json` discloses
`mode=prefetched-untrusted-zip`, the acquisition manifest raw SHA, proof raw SHA,
and `freshDownloadClaimed=false`; the final CLI result also identifies this mode.
The original direct-download entry still runs its original checks. No installed
ECS consumer, SDK, source receipt or five-image build is changed by this addition.

Current policies, protected materializer pins and independent proof admission
must refer to the newly reviewed producer. A local successful test or completed
cache is not evidence of an actual GitHub acquisition or an approved live proof.
