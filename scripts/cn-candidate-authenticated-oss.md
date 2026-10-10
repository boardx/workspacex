# Candidate authenticated ECS download caller

**Select the protocol explicitly.** The new
`cn-candidate-authenticated-untrusted-cache-v1` request uses the
[untrusted-cache protocol](cn-candidate-untrusted-cache.md): it requires **no
GetBucketPolicy call, new grant, bucket policy write, or administrative freeze**.
The older `cn-candidate-authenticated-transfer-v1` request is the legacy strict
protocol; only that protocol requires the policy/fence sections below. There is
no automatic fallback between them. The
[policy example](cn-candidate-oss-policy.example.json) is a **legacy strict-only,
unapplied example**, never the default plan for a live cache transfer.

`cn_candidate_authenticated_oss.execute_from_ecs` is an internal library entry for
`check` or `download`, using the **existing** Shanghai production ECS role. It
never uploads, installs SDKs, creates credentials, edits a policy, or loads Docker.
The local OAuth uploader is a separate native CLI adapter; Python's default
credential provider is not assumed to consume the CLI OAuth profile.

## Shared independent admission

The operator must admit the code and complete dependency closure and provide a
request SHA from an independent protected approval. Request JSON contains exact
account/ECS/role/region, STS assumed-role principal, original plan/set raw SHA,
transport and nested transfer approval, and an operation budget of at most
1,200 seconds. Only the legacy strict request additionally contains a policy raw
SHA and finite fence window; the new cache request rejects those fields. It
accepts no `trusted` boolean. The caller validates original metadata through the
explicitly selected transfer protocol **before**
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

For the new cache protocol, read-only `check` validates the original metadata,
authenticated caller/account, bucket owner/region/private ACL and observed disabled
versioning without reading policy. Failed identity or version observations poison
that operation. These observations do not exclude an administrative race.

### Legacy strict-only policy and clock admission

The legacy strict read-only `check` also validates the original metadata, signed caller/account,
bucket owner/region/private ACL, disabled versioning, policy raw hash and exact
required statements. The provider response Date must be fresh and leave the
remaining operation budget plus a 30-second clock margin inside the policy
window. Missing permissions, missing policy (including current 404), malformed
responses, identity mismatch or changed versioning fail closed. No implicit
permission expansion or login request follows.

## Explicit transport contract clarification

OSS is an **untrusted transport cache**, not a globally immutable release store.
Authenticated transport does not upgrade data provenance. The uploader's own
PutObject/CompleteMultipartUpload requests must forbid overwrite. The legacy
strict protocol additionally requires its approved version-state fence; the new
cache protocol observes disabled versioning without claiming atomic exclusion
of an administrator. Other writers may alter cache objects. No receipt
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

## Legacy strict only: finite policy draft and impact

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
claims a verified production SDK installation. Both protocols still require
actual ECS read-only invocation, root-owned entry/input admission, checks of
existing provider permissions, revalidation integration and publisher admission.
Only the legacy strict protocol additionally requires independent policy
approval/application and policy-read permission; these are not release gates for
the new untrusted-cache protocol, which requests no new grant. The library itself does not grant root trust to supplied
paths or install a production CLI. All result objects keep `productionReady` and
`releaseReady` false.

## Official sources

- [OSS policy syntax and supported conditions](https://www.alibabacloud.com/help/en/oss/user-guide/authorization-syntax-and-elements): CurrentTime date conditions and bucket actions.
- [Bucket-policy FAQ](https://www.alibabacloud.com/help/en/oss/bucket-policy-settings-faq): policies with conditions also constrain the Alibaba Cloud account.
- [CompleteMultipartUpload](https://www.alibabacloud.com/help/en/oss/developer-reference/completemultipartupload): PutObject permission, overwrite-header/versioning behavior, and continued processing after disconnect.
- [Python credentials configuration](https://www.alibabacloud.com/help/en/oss/python-configuration-access-credentials): existing ECS-role provider.
- [Official CLI OSS integration source](https://github.com/aliyun/aliyun-cli/blob/master/cliext/ossutil/ossutil2.go): OAuth-compatible native profile resolution; also documents why automatic binary updates need separate admission.

## Legacy strict only: separately approved temporary read grant

This section and `cn-candidate-oss-policy.example.json` apply only to the legacy
strict protocol. They are not a prerequisite or default execution plan for the
new untrusted-cache protocol. No grant or administrative freeze is required by
that new protocol.

The observed existing `WorkspacexCnProductionOssScoped` role policy lacks
`oss:GetBucketPolicy`. Therefore the legacy strict caller cannot currently pass its real policy
readback; this does not block the new cache caller, which never requests it. `cn-candidate-oss-policy.example.json` is the complete **unapplied draft**
for the currently policy-less fixed bucket `workspacex-cn-prod-assets`: it adds
only that read action to the existing ECS role, for the same <=1-hour interval
as the administrative freeze. The principal uses OSS's documented lowercase
`arn:sts` role-session form, not the differently formatted STS response ARN.
The grant covers policy configuration visibility only; it adds no object read,
write, delete, version, ACL, credential, role-assumption or database permission.
It applies to all existing sessions of that exact role, not only this process.

An authorized bucket administrator must approve this exact impact before applying
it. Before execution, generate fresh UTC timestamps within the approved duration,
read current policy again, preserve any pre-existing statements, bind the exact
new policy raw SHA in the independent request, and get approval for any material
scope change. Do not use the placeholder strings as a real policy, silently
replace an existing policy, or extend the interval automatically. The time-bound
Deny also constrains the bucket owner and prevents policy removal/ACL/version
changes until expiry. Ordinary existing object data-plane permissions remain
available. The draft does not prove an actual applied policy; signed readback
from both callers remains mandatory and any existing explicit Deny still wins.

[Official role-principal and bucket-policy examples](https://www.alibabacloud.com/help/en/oss/user-guide/use-bucket-policy-to-grant-permission-to-access-oss/)
and [GetBucketPolicy permission](https://www.alibabacloud.com/help/en/oss/developer-reference/getbucketpolicy)
provide the grant syntax and action mapping.

## Fixed SDK offline compatibility check

The implementation was additionally exercised with real `oss2==2.19.1`,
`alibabacloud-credentials==0.3.6`, `aliyun-python-sdk-core==2.16.0` and
`aliyun-python-sdk-sts==3.1.2` in an isolated `/tmp` environment. Run
`python -I -B tests/test_cn_candidate_authenticated_oss_sdk.py` there. That test
blocks socket connections while the real SDK signs STS/OSS requests and parses
realistic XML/JSON response models. It verifies the direct Session.send path
used by STS as well as OSS Session.request, including proxy/redirect/TLS pins.
It found and fixed the STS method name (`set_endpoint`) and its direct send path;
mock-only tests would not have established this compatibility. Production
installation, complete dependency hash admission and cloud permissions remain
unverified. SDK DEBUG=sdk mode is rejected because it can print signed requests.
