# Fixed-tag US reconciliation operation

Issue #6081; incident #6078. The exact US production transaction for tag `41248889927-1` committed the three reviewed SQL files once (435 to 438 migration entries). Dynamic target bootstrap passed. The subsequent old-service restart business probe failed; the original failure and pending intent remain retained. Independent terminality checks and a fresh full business probe restored the old application and original Nginx configuration; public health returned HTTP 200. Target application activation is not yet accepted.

`us-reconcile-only.py` records the original operator operation. It never applies SQL, prepares a backup, starts/stops services or changes Nginx. Its executed revisions refused first on an incorrect transcribed attempt, then on the raw-input/canonical-policy hash distinction, and finally on `POLICY_EXPIRED`. Those refusals occurred before fresh bootstrap/business execution. Original evidence, pending marker and timestamps remain unchanged. Do not rerun this expired operation or refresh its timestamps.

## Fresh qualification after a verified commit

The explicit replacement is `scripts/us-complete-reconcile.py`, a root-only library with no CLI. It keeps the historical 435-to-438 COMMIT acknowledgement and original restore evidence immutable. The original backup must have been valid at the actual original ACK file time; that historical check does not claim present freshness.

`us-complete-source-capture.py` captures the actual current 438 ledger, source identity and owner/ACL catalog before and after a new encrypted read-only dump. `schema-complete-restore.py` restores that archive into a new network-none owned clone and checks the complete ledger/catalog and an application-role transaction with rollback. It executes zero reviewed migration statements. Its separate qualification retains a 30-minute validity window and verifies original artifact hashes and cleanup.

Reconciliation then performs fresh target bootstrap and one old-application business probe in a new attempt. A durable one-shot intent prevents re-entry after an unknown acknowledgement, even if the business probe has already removed its own uncertainty marker. Failure leaves the original pending marker and original history intact. Only successful checks permit a separate `COMPLETE_SCHEMA_RECOVERY_VERIFIED` receipt and same-directory archival of the unchanged pending bytes. The activation consumer accepts this explicit proof type and revalidates the new backup; it does not manufacture an old maintenance success receipt or relax the legacy backup gate.

At this update, component and orchestration tests use fixtures for Docker and database operations. The replacement has not run against production. Actual current-schema restore, reconciliation, candidate activation, public browser acceptance and CN qualification remain outstanding.

CN read-only capacity investigation: the existing ECS RAM role can read `DescribeDBInstanceAttribute` after supplying the CLI's global `--region cn-shanghai`; `--RegionId` alone does not configure that global CLI setting. PostgreSQL performance reads were denied by existing permissions. Without granting new access, the already authenticated RDS console for the exact instance displayed `已使用 4.13G ( 共 100G )`. This is an observed console capacity reading, not an automated performance/IOPS qualification. The faithful local CN role clone still cannot reproduce the provider-reserved role membership. No CN migration or new shared-RDS clone has been executed.

The script contains no credentials, backup data, user content or provider output. Original sensitive proof stays private on the production host. Code review and compilation are not production acceptance.
