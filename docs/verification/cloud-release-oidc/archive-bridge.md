# Archive bridge — isolated implementation checkpoint

Status: incomplete, not approved for installation or publication. `--publish` rejects
with `ARCHIVE_BRIDGE_REVIEW_INCOMPLETE` before reading the plan or acquiring credentials.
No workflow invokes the importer; no archive-export workflow has been added yet.

The current producer normalizes five Docker-save archives for api, web, deep-agent,
skill-sandbox and postgres-age. Each archive binds its config image ID, raw layer
hashes, source/control revision and linux/amd64 platform. Redis remains an independently
approved existing registry digest. The consumer uses actual RepoDigests and the original
TypeScript manifest/seal CLIs; image IDs are never treated as registry digests.

The fixed prospective target is the existing Shanghai VPC registry
`workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod`,
instance `cri-ttm0916mvdvg4ugx`. No real staging object coordinates or upload/download
principals have been supplied. The transport contract requires them and has no guessed
bucket, credential, upload/download, or installation fallback.

## Evidence at this checkpoint

`python3 -B -m unittest discover -s tests -p test_cn_image_archive.py -v`
passed 13 local tests on 2026-10-08. They exercise malformed archives and metadata,
expiry, duplicate JSON, dirty control rejection, all-target remote collision prechecks,
lost push acknowledgement, failure cleanup, owned staging references, and repeat
publication without repeat pushes. Docker/cloud/API/production were not used.
This proves the isolated contract/sequence cases only, not real Docker/CLI interoperability.

Independent review reproduced the first draft's last-image conflict after four earlier
pushes. The sequence now probes all five remote configs before loading/tagging/pushing;
the regression simulation verifies zero such mutations on that conflict.

## Remaining release blockers

- Complete independent review of protected inbox handling, capacity/deadline coverage,
  credential handling, cleanup error precedence and canonical output path protection.
- Test the original Node closure end to end and finish completed/torn receipt retry handling.
- Bind all-five repository immutability to protected provider evidence, not an approval list;
  only api's immutability was established by prior browser evidence.
- Add the manual-main-only hosted export workflow and its independent trigger tests.
- Real approved transport coordinates/principals, binary/control closure and fresh capacity
  information must be supplied through separately reviewed, root-protected plans.

The existing production release lock serializes local operations; it is not idempotency
and cannot guard external registry writers. Partial remote publication cannot be rolled
back as a transaction. Failure cleanup must never prune shared images, delete others'
references, build on production, prepare/activate a release, or change running containers.

## First safe integration sequence

Re-read exact main/PR HEADs and live pending prepare runs. Land the reviewed manual-only
prepare gate first with separate authorization; existing main currently has an automatic
workflow_run entry, so any main merge can reach that chain. Do not issue a token by merging
an OIDC diagnostic around it. Only after guard verification and closure of the blockers
above should an archive-only hosted run, reviewed staging, and a separately approved
import/tag/push/readback be considered. Preparation and activation remain separate gates.
