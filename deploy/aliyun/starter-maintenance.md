# Starter maintenance CLI

Run on the already provisioned ECS as root, using the repository/driver containing this
command and the saved deployment config and immutable release manifest. Maintenance
is outside the five-minute provision operation. The OSS transfer has a separate
one-hour limit; the PG16 dump/restore tools have their own bounded timeouts.

Prerequisites are the existing private runtime directory (`compose.json`,
`secrets/owner-password`), the running Starter PG container, the prewarmed API image
at the manifest digest, and the protected `backupTargetRef` described in
[Starter backup and restore](./starter-backup-restore.md). No new database password or
hand-built Docker command is required. Missing or corrupt existing secrets fail; the
maintenance command never regenerates or rotates them.

```sh
# New private directory; backup defaults to the application database.
node --import tsx packages/cloud-deploy/src/starter-maintenance-cli.ts backup \
  /etc/workspacex/deployment.json /etc/workspacex/release.json \
  /var/lib/workspacex-runtime /var/backups/workspacex/run-001

# Back up Agent persistence independently.
node --import tsx packages/cloud-deploy/src/starter-maintenance-cli.ts backup \
  /etc/workspacex/deployment.json /etc/workspacex/release.json \
  /var/lib/workspacex-runtime /var/backups/workspacex/agent-001 workspacex_agent

# Fetch the returned backup UUID, then restore into a NEW database.
node --import tsx packages/cloud-deploy/src/starter-maintenance-cli.ts restore \
  /etc/workspacex/deployment.json /etc/workspacex/release.json \
  /var/lib/workspacex-runtime /var/backups/workspacex/restore-001 \
  restored_20260911 01234567-89ab-4def-8123-456789abcdef
```

The final positional database parameter is optional for `backup` and accepts only
`workspacex`, `workspacex_agent`, or `workspacex_memory`. The Memory database uses
the same backup command with `workspacex_memory` as the final argument. `restore` requires both the new database name and
backup UUID. Restore rejects the live application/Agent databases, PostgreSQL system
databases, and any database that already exists. It creates no cutover or connection
configuration changes: promotion of the recovered database is a separate explicit
operation. The parent directory for the new backup directory must already exist.
The new directory contains `archive/database.dump` and `archive/manifest.json`.

The driver validates the saved Compose project and API/PG digests, locates exactly one
running PG container by Compose labels, verifies its data-volume mount, reads the
existing owner secret, and resolves the backup target. The API transfer job is pinned
to its verified digest, runs as root with all capabilities dropped and a read-only
root filesystem, and mounts only this operation's new backup directory. Upload mounts
it read-only; download mounts it writable. OSS role configuration is passed via a
0600 temporary Docker env-file. Database passwords never enter Docker arguments or
the transfer container. The job does not receive Docker's socket, runtime directories,
application secrets, or arbitrary host paths.

Backup output is fixed structured JSON containing `backupId`, `sha256`, `bytes` and
operation. An upload must explicitly confirm full readback verification. Download
must match the requested ID and the synced local manifest before restore starts.
CLI failures print a fixed reason without raw Docker, SDK, SQL or secret payloads.
No cloud objects are deleted, no existing directory is reused, and no old backup is
overwritten. Interrupted runs leave their new local files for explicit diagnosis.

Maintenance acquires the same `provision.lock` as provisioning. A concurrent operation
fails immediately. Cleanup stops only the randomly named maintenance container and
removes its own env-file. If cleanup cannot be proved, the shared lock is retained;
inspect that named job and private runtime directory before explicitly recovering the
lock. Never delete a lock merely because its PID is absent.

Validation is split: isolated command/filesystem tests prove orchestration, identity,
secret handling and failure cleanup; the underlying PG16 restore was tested against
all migrations and the transfer was tested with the real OSS SDK over a loopback
protocol fixture. A real ECS role-authenticated maintenance run is cloud acceptance
and remains unverified until run against the configured region and bucket.
