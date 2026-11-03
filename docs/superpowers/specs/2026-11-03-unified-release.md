# Unified manual application release — #6187

User decision: devapp, CN and US use the same release process. Environment configuration supplies host, database, domain, paths, credentials and Compose project. User clarified that code checks and full functional regression belong to GitHub; hosts only pull images, update configuration, apply pending SQL and confirm runtime readiness. Browser/business regression is not a host release gate. No automatic release on merge. Use an existing tag without rebuilding, or manually build the selected branch. Historical host files may be cleaned only after reference and mount inventory.

## Approach
Keep Docker Compose and immutable registry images. Replace per-tag migration policies and release-specific script bundles with one installed release runner and one reusable SQL migration driver. Retaining separate per-environment engines would preserve the failure modes this request removes. Replacing Compose with Kubernetes would introduce unnecessary infrastructure.

## Host layout
A private release root contains config/, log/, current/, previous/, backup/, data/. Actual Docker image layers remain in Docker storage; current/previous contain immutable image and Compose references, not duplicate tar exports. Database and file data remain on non-releasing data disks or managed services. Never move live database files or Docker storage as part of ordinary release.

## Process
Acquire the existing canonical environment lock; pull and verify the full image set; render and validate configuration before stopping anything; inspect pending SQL using the candidate image; when SQL is pending, back up the database then execute pending SQL through a migration account; update application containers; verify exact image IDs, service readiness; atomically publish current/previous metadata. Config secrets remain private and are not printed. Configuration changes are captured with the version so image rollback also restores its runtime configuration.

SQL driver checks database identity and uses the existing _kernel_migrations table and PostgreSQL advisory lock, one transaction per file, and records each commit with that SQL. Like the application migrator, repeat releases skip committed filenames, preserve their original ledger checksums, and report edited/removed historical files without replaying them. SQL corrections must use new filenames. Connection loss around COMMIT requires a fresh ledger query before another apply; never blindly replay a query with an unknown result. No --force in production.

Failure restores previous application images/configuration and verifies them. It does not reverse committed SQL. Previous-version compatibility is a migration requirement; destructive schema changes use expand/contract. Failed or interrupted release state must preserve database state explicitly. An uncertain application switch must be recovered against its recorded baseline, not silently adopted as the new baseline.

## Cleanup
Inventory running and stopped containers, bind mounts, named volumes, Compose labels/config paths, active installed commands, systemd/cron and release pointers first. Preserve current/previous images, all referenced inputs, data, database backups and unresolved incident records. Produce an explicit candidate list, quarantine obsolete tool bundles, verify a real release and rollback, then remove quarantined leftovers. Never use compose down -v, volume prune or broad rm against old runtime roots.

## Acceptance
Local fault tests cover pending/already-applied/changed SQL, partial commits, wrong database, concurrent releases, config omissions, pull failure, switch failure, rollback failure and interrupted recovery. Real host acceptance must include tag reuse on CN and the same runner on devapp/US, with real runtime/image/health evidence. Local tests alone do not establish production success. Disaster recovery qualification is separate from ordinary releases.
