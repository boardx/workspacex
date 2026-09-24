# MinIO controlled-registry recovery

Issue #4100 records a shared infrastructure failure: the MinIO release used by the API
compose stack stopped pulling anonymously from `quay.io`. The same failure appeared on
`main` and on Board PRs #3983, #4093, #4095, and #4098. This is a registry availability
incident, not evidence that those branches changed MinIO.

`apps/api/docker-compose.minio-image.yml` is the only image declaration used by both the
development and deployment compose files. Its current `awaiting-controlled-mirror` state is
intentional: no already-published `boardx` image could be anonymously inspected, so this
change does not invent a digest and does not claim the CI outage is resolved.

## Promotion procedure

1. Obtain and independently verify the exact manifest-list digest for the release named in
   `docker-compose.minio-image.yml`. A mutable tag is not an acceptable input.
2. Dispatch `mirror-minio-controlled-registry` with operation `mirror` and that digest. The
   workflow copies all platforms to `ghcr.io/boardx/workspacex-minio` with
   `--preserve-digests`, then verifies the target manifest through an authenticated read.
3. A BoardX organization package owner makes the GHCR package public. Repository code cannot
   safely self-attest this setting, and the workflow deliberately does not accept an env
   boolean in its place.
4. Dispatch the workflow again with `verify-public-and-render-lock` and the same digest. This
   read has no registry credentials. Any private, missing, changed, or inaccessible manifest
   fails closed. Success produces a `minio-image-lock.patch` artifact.
5. Review and apply the artifact in issue #4100's PR. The patch changes the compose image to
   `ghcr.io/boardx/workspacex-minio@sha256:…` and records identical source/target digests.
   Run `pnpm run lint:minio-image-lock` and the harness test before merge.

The workflow never starts Docker. Local static validation also needs no Docker daemon. A
successful mirror operation alone is insufficient: CI remains blocked until the anonymous
verification succeeds, the digest lock patch lands, and the affected lanes pass with that
exact image.
