# Prepare an existing ECS host

This explicit command runs on a dedicated Linux ECS as root, before the five-minute
provision timer. Docker, Docker Compose 2.30+, Node 22+, Git, AppArmor and
`apparmor_parser` must already be installed. It does not install packages, create cloud
resources, modify system ingress configuration, or restart any other service.

Use the clean checkout whose full Git SHA exactly matches `sourceRevision` in the
release manifest. The config, manifest and protected TLS reference must already be
available. The TLS payload contains `certificatePem` (leaf/full chain) and
`privateKeyPem`; the key must match the leaf, whose DNS name and validity must match
the deployment's HTTPS origin. This first ingress renderer requires port 443.

```sh
node --import tsx packages/cloud-deploy/src/prepare-host-cli.ts \
  /etc/workspacex/deployment.json /etc/workspacex/release.json \
  /opt/workspacex-checkout /var/lib/workspacex-runtime
```

Both profiles prepare a new private runtime directory containing:

- `docker-seccomp.json` and `docker-apparmor-sessions`, taken from canonical files in
  the manifest's exact Git commit;
- private `ingress/fullchain.pem` and `ingress/private-key.pem`;
- `nginx.conf`, generated for the configured domain and local Web/API ports;
- `prepare-receipt.json`, containing the installation ID, input/file hashes, policy
  ownership status and explicit preparation boundary, never the private key.

Starter additionally creates the configured data directory with an ownership marker
and separate `postgres` and `redis` subdirectories. Production uses managed databases
and does not create local data directories. Parent directories must already exist;
the runtime, checkout and Starter data roots must be separate. The command refuses to
adopt an existing directory without its matching private receipt/ownership marker.

The command verifies Docker platform, adds only the canonical
`workspacex-native-sessions` AppArmor profile, confirms enforce mode, pulls the exact
manifest digests and verifies image platform/revision/digest metadata using the
existing release prewarm module. It never changes `docker-default`. An existing
unowned profile is rejected. A rerun can replace this application's profile only after
its own persisted receipt proves prior management and all protected files match their
recorded hashes. Changed certificates, release inputs or hand-edited files fail; they
are not silently replaced. Interrupted unproved AppArmor loading retains the shared
`provision.lock` for explicit inspection.

A successful command returns `readyForProvision: false`, `cloudVerified: false` and
`status: files-ready-ingress-installation-required`. Before provision, the operator
must review and install the generated Nginx include in the intended server's `http`
context, test that server's Nginx configuration, and apply a targeted ingress reload.
The command does not overwrite `/etc/nginx`, enable sites, claim DNS readiness or call
an endpoint before its ingress is installed. Provision still performs actual ECS
identity/role, TLS endpoint and dependent-service verification.

Preparation is separate from the provision SLA and permits up to one hour for image
prewarming. File hashes and receipts permit replay after a pull failure; no image
build occurs. A profile-load uncertainty or mismatched file requires explicit
inspection. Never discard a retained lock or overwrite changed files automatically.

Validation: mock command/filesystem tests cover Starter and production, private files,
exact-source copies, digest prewarm, safe replay, foreign paths and AppArmor profiles,
dirty checkout rejection, Mac rejection, and uncertain policy loading. No Linux host
mutation or cloud operation was performed by these tests; ECS execution remains a
separate acceptance check.
