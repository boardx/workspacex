# Protected ECS authenticated check/download entry

Issue #5547. This entry is a preparation component, not a release or production
activation. It never calls publisher, Docker, ACR, upload, IAM or bucket mutation.
It calls the separately reviewed `execute_from_ecs` contract. Request protocol
selection stays in that library; this entry adds no bucket policy/fence claims.

## Installation inputs (not yet installed)

The official SDK target is CPython 3.12 Linux x86_64. Production read-only evidence
pins `/usr/bin/python3.12` 3.12.3, 8020928 bytes, SHA256
`e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f`.
The entry verifies both that path and `/proc/self/exe`, and requires `-I -S -B`.
The trusted OS stdlib, loader and shared libraries remain host dependencies; their
complete hashes are not claimed by the SDK wheel manifest.

All admitted code files named in `BASE_CODE` must be root:root 0700 ordinary
single-link files. Only the launcher goes in `/usr/local/lib/workspacex-cn`;
all other code lives under its own immutable
`/usr/local/lib/workspacex-cn/candidate-download-code/<controlRevision>/` directory
(root:root 0700). The exact 40-character controlRevision is independently bound
by the root approval, together with every file hash. Existing v1 and publisher
files must never be replaced to install this entry. Any existing target mismatch must fail without overwriting or changing permissions.
`cn_candidate_revalidation.py` is always in the code closure, because consumers
import it even on paths without optional revalidation inputs.

The wheel manifest and exact wheel files belong under
`/usr/local/lib/workspacex-cn/python-oss-runtime/<manifest SHA256>/`: root:root
0700 directory, root:root 0600 ordinary single-link files. A reviewed offline
installer must create this fresh directory without overwriting an existing one.
No pip or setup.py runs on ECS. Admitted wheels are validated then extracted to a
new private runtime snapshot under `/var/lib/workspacex-cn` for one invocation.
Mac wheels, unapproved bytes, symlinks, traversal, `.pth`, `.pyc`, duplicate paths,
wheel `.data` installers and non-x86_64 native ELF files are rejected. The sole
exception is the hash-admitted `jmespath-0.10.0-py2.py3-none-any.whl`'s exact unused
`jmespath-0.10.0.data/scripts/jp.py` CLI, which is omitted rather than installed or
executed; the imported jmespath package is retained intact. A wheel
hash proves equality to independently approved bytes; it alone does not prove
PyPI provenance. The package review must retain PyPI metadata/download SHA256,
source distribution hashes and, if required, the Linux wheel-build evidence.

## Approval and invocation

Use a new root-private input directory:
`/etc/workspacex-cn/candidate-download/<source>/<original build attempt>/`.
Do not rename the original build attempt to a later verification ID.
Root:root 0600 `approval.json` is independently approved by its raw SHA256. Its
exact schema is enforced by `admit_approval`, including operation, source/attempt,
TTL no longer than one hour, maxSeconds no greater than 1200, every code hash,
SDK manifest hash, and raw input hashes. Required input filenames are
`request.json`, `candidate-plan.json`, `candidate-set.json`; optional proof and
policy filenames must be supplied together. The request's independent hash is
forwarded to the library without learning it from the remote cache.

Default invocation is a **real authenticated check**:

```sh
/usr/bin/python3 -I -S -B /usr/local/lib/workspacex-cn/execute-cn-candidate-download.py SOURCE ORIGINAL_ATTEMPT CHECK_APPROVAL_SHA
```

Downloading requires a distinct approval with `operation=download` and explicit
`--download`. The fixed destination parent must already be root-private:
`/var/lib/workspacex-cn/candidate-inbox/<source>/`. The library receives the
original attempt as its atomic snapshot name. No caller-supplied destination is
accepted. Check does not create a destination or start transfer. The existing
release lock must be a private root ordinary file; it is held through the child
and compared with the named inode after flock. No release lock is created.

A parent process supervises the credential-bearing child with a monotonic timeout
and kills its own child process group on expiry. The budget begins at launcher
entry and is clamped to the approval expiry; the remaining time is checked again
after SDK extraction, before any credential-bearing callback begins. The child has a clean environment,
no stdin/stdout/stderr, and reports only a bounded JSON result through a pipe.
This intentionally leaves SIGALRM free for the transport library's own bounded
network/download operations. Errors expose a fixed rejection code, never raw SDK
exceptions. There is no automatic retry.

## Verification and remaining release gates

`python3 -m unittest discover -s tests -p test_cn_candidate_download_entry.py -v`
checks deadline/reaping, library alarm compatibility, redacted failures, bounded
output, independent approval identity/hash/expiry, path traversal, unsafe wheel
contents, wheel byte mismatch and foreign architecture rejection.

This preparation is not evidence of production installation, credential access,
SDK import compatibility or a successful OSS read. Before use, the completed
Linux wheel closure requires actual CP312 Linux imports and the existing SDK
serialization tests; the integrated library requires its own reviewed commit,
CI and real authenticated check-only receipt. Root installer and installation
review remain separate deliverables. No generated manifest is an approval.
