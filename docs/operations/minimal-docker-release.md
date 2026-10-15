# Minimal release on an existing Docker Compose host

Phase 1 replaces the images of existing WorkspaceX application services on one prepared Docker host. It preserves the current Compose configuration, environment references, networks and data mounts. It does not run database migrations or provision a new environment.

A fork needs one host configuration and one immutable release manifest. Run the same release command on the host through an already authorized execution channel. No WorkspaceX-specific cloud account, new sudo entry, SDK or dedicated cgroup is required by this command. A new host and its existing Docker privileges are one-time environment preparation, separate from each release.

## Scope and completion

| Phase | Delivery |
| --- | --- |
| 1 | Configuration template, immutable source/image manifest, one command, minimum prechecks, existing-image deployment, health and actual image readback, explicit receipt. Demonstrate one real deployment. |
| 2 | Repeat a release, measure a second run, strengthen idempotency and rehearse recoverable failures. |
| 3 | Full business journeys, schema/data migrations and additional customer environments. |

Every newly discovered issue is classified as blocking the first actual run, required for safety/authorization, or deferred. Full model/QA acceptance, optional sidecars, generalized cross-cloud orchestration and complex recovery machinery are deferred. A failed external dependency produces a failure receipt; success on every attempt is not promised.

## Data boundary

Only existing application services may be changed. PostgreSQL and Redis are excluded; the command must not use `down`, volume deletion, pruning, migration/admin jobs, image builds or implicit pulls. It reuses the original Compose file with an image-only override and `up --detach --no-deps --pull never --no-build`.

Matching actual baseline and candidate migration inventories is required before changing services. Empty/missing evidence is a failure. The command does not infer compatibility from a caller-supplied “passed” flag. Existing API startup initialization, log retention and task recovery can still write data; no-schema deployment does not mean database zero writes. Production use must retain the applicable startup-side-effect authorization.

## Result and first validation

The receipt distinguishes planned, succeeded and failed execution. Health and actual running image IDs establish the minimum deployment result; they do not claim full business acceptance. A failure is explicit and is not automatically retried. Retain prior image IDs and configuration before mutation; do not describe image restoration as recovery of deleted database records.

The first executable validation uses the actual command with fake Docker and HTTP endpoints. It checks existing-image success, forbidden command absence, incompatibility before mutation, wrong image identity and unhealthy results. This is an offline command test, not production acceptance. A real run is reported separately with its actual receipt and elapsed time.

## Configure a fork and run

Copy `deploy/examples/minimal-config.json` and `minimal-manifest.json` into a private deployment directory. Fill the actual five image IDs, full application source revision and original build/artifact/archive references from verified build results. The command consumes images already loaded on the target; use the existing build/transport lane when they are absent. It does not invent artifact provenance or download images.

Set the existing Compose project and application service names, absolute Compose/interpolation-file paths with their actual SHA256 values, the SHA256 of the final manifest bytes, the already shared `lockFile`, and a health endpoint with its required JSON fields. Keep credentials in the existing environment files. Do not put secret values in the configuration or manifest. The example paths and placeholder values are not a production approval or ready deployment.

```sh
python3 scripts/minimal-docker-release.py \
  --config /private/deployment/config.json \
  --manifest /private/deployment/manifest.json \
  --output /private/deployment/attempt-plan
```

Plan mode creates private evidence files and temporary stopped image-inspection containers. It does not start application services. Inspect the plan, then use a fresh private output directory and the same reviewed files with `--apply` to deploy. The existing shared lock must already exist with private ownership/mode; the command does not create a competing lock. On the current CN host that is `/var/lib/workspacex-cn/runtime/release.lock`; the fork template path is an example and must not replace an already active installation lock. It checks actual migration bytes in stopped API/agent images, and refuses images with declared volumes for these probes.

```sh
python3 scripts/minimal-docker-release.py \
  --config /private/deployment/config.json \
  --manifest /private/deployment/manifest.json \
  --output /private/deployment/attempt-apply --apply
```

Read `receipt.json` and the exit status. Readiness is a bounded read-only wait (1–120 seconds), not another deployment attempt. If application changes have started and verification fails, the result is `FAILED_OR_UNCERTAIN`; inspect before another release. Phase 1 records prior image IDs and does not claim automatic rollback. Use the original Compose files plus a reviewed prior-image override for manual image restoration; this does not restore deleted database records.

For the exact BC application source, API startup deletes expired global `error_logs` and `debug_events`, seeds platform content by default, and resumes background work. Production execution requires a specific confirmation for the current run's irreversible deletion when recoverability is unproved; the earlier domain-switch confirmation is not automatically reused. Code tests and isolated fixture deployments do not perform those production deletions.

Run the offline command suite with `python3 -I -B tests/test_minimal_docker_release.py`. Real Docker fixture validation is reported separately from both fake-command tests and production acceptance. No production deployment has been performed by this source change.
