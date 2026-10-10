# Native candidate upload (issue #5547)

`cn_candidate_native_cli.py` uses the installed Alibaba CLI 3.5.0 and ossutil
2.4.0 with exact SHA-256 pins. OAuth conversion happens inside the official CLI;
this code never reads profile/credential files, exports credentials, or uses a
shell. Only the noncredential ossutil update timestamp is read. Missing, future,
stale, or expiring timestamps reject before invocation; the code never rewrites
this timestamp, installs, or updates anything. Hash checks occur before and after
each invocation. Concurrent same-user replacement of trusted installed software
is outside this process's trust boundary; a detected change rejects the result.

Run the read-only identity/schema probe with Python 3.12:

```
python3 -B scripts/cn_candidate_native_cli.py --probe-bucket workspacex-cn-prod-assets
```

Add `--probe-raw-schema` for one raw BucketInfo format observation. It returns
only structure and Date presence. Both commands discard raw stderr; they do not
create a policy or upload objects. Existing operator probe evidence confirmed
account `1177216024653153`, the expected root principal, private Shanghai bucket,
and absent Versioning Status. The bucket currently has no policy, which is a
missing fence rather than an authentication failure.

`cn_candidate_native_upload.execute` is the explicit library entrypoint. Integrate
with the reviewed `cn_candidate_authenticated_oss` pure fence functions and
candidate revalidation changes before use. Its separately hashed request schema
is `cn-candidate-native-upload-v1`; it binds original plan/set SHA, fixed account
and bucket, exact upload principal, transport, upload approval, finite fence,
request expiry, and a 1–1200-second budget. Expired candidates require the existing
independently approved revalidation route; original receipt bytes are unchanged.
No command line upload entrypoint or automatic dispatch is installed.

Before any PUT, all seven local objects are copied through pinned source FDs into
a private directory and fully validated. Each exact key gets at most one
PutObject with `forbid-overwrite`, private ACL, and zero retry. The formal 4 GiB
object bound is below the API's 5 GB single-PUT limit, so no multipart or Complete
operation exists. Existing-object or unknown PUT outcomes only proceed through
full size/SHA-256 GET readback, never another PUT. Candidate-set is attempted
last. Readbacks are streamed into a hash sink with an exact output bound and a
shared deadline; no large response is materialized in memory. Errors stay fixed
codes, and timeout/error cleanup kills the CLI process group.

Authentication and bucket owner/location/ACL/versioning are read from actual CLI
responses. A fixed official HTTPS OSS origin HEAD, with standard certificate
validation, no proxy and no redirects, brackets the authenticated reads. The two
provider Dates must be monotonic, within 30 seconds, inside the approved fence,
and leave the entire remaining transfer budget plus 30 seconds. Receipt fields
explicitly distinguish this TLS provider clock from the authenticated policy
observation. Versioning must have absent Status (never Suspended). Before each
PUT and on both sides of every readback the fence is observed again.

Policy `raw` output must exactly match the independently approved provider-byte
SHA and the shared policy validator. The current bucket has no policy, so actual
policy raw-byte preservation is **not yet proven**. Any output decoration/hash
mismatch blocks before PUT; it is never silently canonicalized. Raw BucketInfo
probe confirmed XML without HTTP headers, motivating the separate TLS clock.
Likewise local mocked tests are not a real candidate upload acceptance.

OSS remains an untrusted cache: `remoteCacheImmutable` is false, and this path
never claims release/production readiness. The ECS consumer must still make a
root-private FD snapshot, verify every byte/hash, and publish with NOREPLACE.
The fence freezes only bucket administration for the finite reviewed interval;
it is not a global immutable-object guarantee. This code does not create the
fence, grant permissions, deploy containers, or change production writers.

Validation:

```
TMPDIR=/private/tmp python3 -B -m unittest discover -s tests -p 'test_cn_candidate_native*.py' -v
```
