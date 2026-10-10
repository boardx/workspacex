# Candidate v2 authenticated ECS download caller

`cn_candidate_authenticated_oss.execute_from_ecs` is an internal library entry for
`check` or `download`, using the **existing** Shanghai production ECS role. It
never uploads, installs SDKs, creates credentials, edits a policy, or loads Docker.
The local OAuth uploader is a separate native CLI adapter; Python's default
credential provider is not assumed to consume the CLI OAuth profile.

## Independent admission

The operator must admit the code and complete dependency closure and provide a
request SHA from an independent protected approval. Request JSON contains exact
account/ECS/role/region, STS assumed-role principal, original plan/set raw SHA,
transport and nested transfer approval, policy raw SHA, a finite fence window,
and an operation budget of at most 1,200 seconds. It accepts no `trusted` boolean.
The caller validates original metadata through CandidateTransfer **before**
acquiring credentials. Expired candidates still fail by default. Explicit renewal
requires both independently approved proof/policy SHA and the original policy
bytes; the optional `cn_candidate_revalidation.admit` capability performs renewal.
No hash is learned from untrusted downloaded metadata.

The official ECS credential provider uses IMDSv2, with no default/config-file
fallback. Fixed instance and region metadata are checked first. One in-memory
credential snapshot signs STS GetCallerIdentity and every OSS request. No
credential is read by our code from disk, exported, serialized or printed.
SDK logging is suppressed during the bounded operation; provider exception text
is replaced with a fixed rejection. STS/OSS HTTPS hosts and methods are pinned,
redirects and proxy environment are disabled. OSS is GET-only for this entry.

The read-only `check` also validates the original metadata, signed caller/account,
bucket owner/region/private ACL, disabled versioning, policy raw hash and exact
required statements. The provider response Date must be fresh and leave the
remaining operation budget plus a 30-second clock margin inside the policy
window. Missing permissions, missing policy (including current 404), malformed
responses, identity mismatch or changed versioning fail closed. No implicit
permission expansion or login request follows.

## Explicit transport contract clarification

OSS is an **untrusted transport cache**, not a globally immutable release store.
Authenticated transport does not upgrade data provenance. The uploader's own
PutObject/CompleteMultipartUpload requests must forbid overwrite while bucket
version changes are fenced. Other writers may alter cache objects. No receipt
claims otherwise (`remoteCacheImmutable` is false).

Download reuses CandidateTransfer's private directory, pinned descriptors, exact
seven-object size/SHA checks, Docker config/layer validation and atomic Linux
RENAME_NOREPLACE. Only successful complete download returns
`cacheSnapshotVerified: true`. Future remote changes cannot change those local
bytes. The downstream publisher must independently admit and snapshot these bytes
again before load/tag/push. ACR immutable tags, Redis authentication, proof TTL,
and all production approval gates remain independent requirements.

An altered metadata file or tar, including a change during GET, fails its
independently approved size/hash and publishes no directory. A later cache rewrite
cannot change an already pinned local source. Lost upload acknowledgements must
only trigger exact readback; they never authorize a second PUT. Existing tests in
`test_cn_candidate_oss.py` exercise corruption cleanup, metadata binding,
no-replace, and unknown-ack behavior. The new adapter tests exercise authentication,
policy/clock/identity rejection and zero-write checks; they are offline tests,
not proof that cloud access or installed SDK versions currently work.

## Finite policy draft and impact

`required_statements(request)` creates the exact statement below, substituting
only the independently approved bucket and timestamps. Preserve every existing
statement when preparing a new whole policy. This function does not apply it.

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Deny",
    "Action": ["oss:PutBucketVersioning", "oss:PutBucketPolicy", "oss:DeleteBucketPolicy", "oss:PutBucketAcl"],
    "Principal": ["*"],
    "Resource": ["acs:oss:*:1177216024653153:<approved-bucket>"],
    "Condition": {
      "DateGreaterThanEquals": {"acs:CurrentTime": "<approved-start>"},
      "DateLessThan": {"acs:CurrentTime": "<approved-end>"}
    }
  }]
}
```

The window is at most one hour. It adds no Allow. It temporarily prevents changing
versioning, ACL and the policy itself for that one bucket; object operations on
all prefixes retain their existing permissions. This means administrators cannot
remove this policy during the window. At expiry normal existing authorization
resumes; no automatic extension, policy rewrite, deletion or retry exists.
The statement contains no AccessId, so upload/download can use different existing
identities. Its raw SHA and transport identity are independently approval-bound.

This draft requires separate approval before any policy write. A real signed
readback must confirm the installed policy bytes and the required semantics.
A time-based Deny is not proof that all previously accepted writes have drained:
OSS documents that an accepted multipart completion may continue after a client
disconnect. This entry makes no global write-drain or remote immutability claim.

## Dependencies and remaining release gates

Required official Python packages are `oss2`, `alibabacloud-credentials`,
`aliyun-python-sdk-core`, and `aliyun-python-sdk-sts`. The admitted runtime must pin
and hash their complete installed closure; this change neither installs nor
claims a verified production SDK installation. Actual ECS read-only invocation,
root-owned entry/input admission, independent policy approval/application,
provider permission checks, revalidation integration and publisher admission
are still required. The library itself does not grant root trust to supplied
paths or install a production CLI. All result objects keep `productionReady` and
`releaseReady` false.

## Official sources

- [OSS policy syntax and supported conditions](https://www.alibabacloud.com/help/en/oss/user-guide/authorization-syntax-and-elements): CurrentTime date conditions and bucket actions.
- [Bucket-policy FAQ](https://www.alibabacloud.com/help/en/oss/bucket-policy-settings-faq): policies with conditions also constrain the Alibaba Cloud account.
- [CompleteMultipartUpload](https://www.alibabacloud.com/help/en/oss/developer-reference/completemultipartupload): PutObject permission, overwrite-header/versioning behavior, and continued processing after disconnect.
- [Python credentials configuration](https://www.alibabacloud.com/help/en/oss/python-configuration-access-credentials): existing ECS-role provider.
- [Official CLI OSS integration source](https://github.com/aliyun/aliyun-cli/blob/master/cliext/ossutil/ossutil2.go): OAuth-compatible native profile resolution; also documents why automatic binary updates need separate admission.
