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

1. Review the explicit MinIO `release_tag` in `docker-compose.minio-image.yml`, then dispatch
   `mirror-minio-controlled-registry` from the repository default branch with operation
   `mirror`. The workflow itself resolves that configured tag from the upstream registry;
   there is no operator-supplied digest to trust.
2. The mirror job copies the resolved manifest and all platforms to
   `ghcr.io/boardx/workspacex-minio` with `--preserve-digests`, verifies the target through an
   authenticated read, and emits a durable GitHub-signed receipt. Record the successful
   workflow run ID. The receipt binds the source repository, configured release tag, target,
   digest, repository, commit, run ID, and run attempt.
3. A BoardX organization package owner makes the GHCR package public. Repository code cannot
   safely self-attest this setting, and the workflow deliberately does not accept an env
   boolean in its place.
4. Dispatch the workflow again from the default branch with
   `verify-public-and-render-lock` and the recorded `mirror_run_id`. The read-only verification
   job downloads that run's receipt and verifies its GitHub artifact attestation, signer
   workflow, default-branch ref, and source commit. It then re-resolves the repository's
   current upstream tag and anonymously reads the target. The attested source, authenticated
   target, current upstream, and anonymous target digests must all be identical. A missing
   attestation, direct verify without a mirror run, configuration drift, tag movement, private
   target, or digest mismatch fails closed. Success produces a `minio-image-lock.patch`
   artifact.
5. Review and apply the artifact in issue #4100's PR. The patch changes the compose image to
   `ghcr.io/boardx/workspacex-minio@sha256:…` and records identical source/target digests.
   Run `pnpm run lint:minio-image-lock` and the harness test before merge.

The signer identity passed to GitHub CLI uses its workflow identity format,
`boardx/workspacex/.github/workflows/mirror-minio-controlled-registry.yml`. It is deliberately
not an HTTPS URL; `gh attestation verify --signer-workflow` accepts
`[host/]owner/repo/path/to/workflow` and GitHub.com needs no host prefix.

The workflow never starts Docker. The mirror job alone has `packages: write`; the verification
job has read-only Actions, attestation, and repository permissions and never authenticates to
GHCR. Local static validation also needs no Docker daemon. A successful mirror operation alone
is insufficient: CI remains blocked until the anonymous verification succeeds, the digest lock
patch lands, and the affected lanes pass with that exact image.
