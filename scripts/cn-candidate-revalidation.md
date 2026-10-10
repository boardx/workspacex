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
provider archive SHA256 and sizes. Seven ZIPs are fetched: plan, collection metadata
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
