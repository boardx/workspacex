# Devapp disk and image retention incident (#6472)

The existing daily timer did trigger at 2026-11-09 03:45:09 Asia/Shanghai,
but its service exited 1 one second later. Its script still consulted the legacy
`/var/lib/workspacex-image-release/devapp/current.json`; all five recorded
service images differed from the real unified deployment. A live dry run stopped
with `runtime drift`. The authoritative current/previous state now resides in
`/srv/workspacex/config/versions.json`.

At investigation, the root filesystem was 148G with 144G used and zero ordinary
available space. Docker reported 91.12GB images (78.61GB reclaimable) and 7.122GB
build cache. The GitHub `devapp-x64` runner (id23) was offline, though systemd
still considered its process running. Old queued run42553150931 occupied the
deployment concurrency group; new run42640609455 had built all five images.

The obsolete, never-started deployment was cancelled. Reclaiming unused builder
cache released 5.251GB plus 97.64MB. Restarting the existing runner allowed the
new deployment to start. Its canonical versions pointer advanced to immutable
tag42640609455-1/source8c2b26d8c154ad1be7530ddbba4057cc19dd2efb, but disk pressure
returned and GitHub reported failure. A version pointer is not health evidence.

The replacement retention entry reads the canonical private configuration and
versions object while holding the existing release lock. It requires a successful
matching attempt/result and no unresolved active release, and verifies the real
current container images. It protects current, previous and every container
reference, including stopped and foreign containers. Only same-registry images
older than 24h qualify. Docker deletion never uses force; volumes and business
data are not touched. A systemd drop-in changes only this service's ExecStart,
keeping the existing schedule and access model.

## Validation

- Nine Python unittest cases pass, including current/previous/container protection,
  mixed/foreign registries, age, runtime drift, incomplete rollback, malformed
  timestamps, digest-only images, dry-run non-mutation and non-force deletion.
- `python3 -m py_compile scripts/unified-image-retention.py`: PASS.
- `bash -n scripts/install-unified-image-retention.sh`: PASS.
- Independent initial source review found no blocker; requested candidate
  identities were added to the dry-run output.
- Actual Devapp dry run PASS: protectedImageCount18, candidateCount107,
  applyfalse. Uploaded script SHA256
  `a45931f20d96d6fe8493734258ce525a3263a59d5768c5db5bfb8d73532fbb9e`
  matched the reviewed source. Apply was then initiated; final operational
  outcome is recorded in the issue/PR comments, not assumed here.

No CN/US write, data-volume deletion, credential change or security weakening was
performed. Runtime availability and browser acceptance must be verified separately
from retention success or the GitHub job conclusion.

Actual apply completed with `RETENTION_EXIT=0` and `OK retention check complete`.
The root filesystem then read 148G total, 68G used, 74G available, 48% usage.
The reviewed script was installed root-owned at
`/usr/local/sbin/workspacex-unified-image-retention.py`, and an ExecStart-only
systemd drop-in was installed for the existing retention service. The old script
and original unit remain available for inspection. A real service invocation and
runner reconnection were initiated, followed by a new devapp-only deployment of
the same immutable tag. Their final results still require live verification.
