# Deployment credential rotation (#2850)

This is an operator runbook, not an automatic production rotation. Use the reviewed
production approval path. Remove the affected historical Actions run logs separately.
Coordinate a maintenance window and take protected database/configuration backups.
Keep old credentials in restricted recovery storage until the new configuration passes
health and feature probes. Do not print secrets or pass their values to a shell command.
Edit the protected 0600 deployment environment file with an authorized secret editor.

| Keys | Rotation and affected runtime |
| --- | --- |
| `APP_DB_PASSWORD`, `DIAG_DB_PASSWORD` | Set matching role credentials and deploy-file values together; reviewed deploy aligns app_rw/app_diag_ro using SQL stdin. Restart API and check trustworthy/RLS health plus diagnostic reads. |
| `MIGRATION_DB_PASSWORD` | Coordinate the migration-role password with the database operator, update its deploy-file value, and verify a read-only migration connection before the next deploy. Do not run a migration solely to test credentials. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Create a scoped replacement object-store identity, update both values together, restart API, test authorized upload/download, then revoke the old identity. Retain bucket data and policies. |
| `EMAIL_VERIFICATION_SECRET` | Update the file and restart API. Outstanding verification links signed with the old secret become invalid; provide a resend path and verify a newly issued link. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Issue a least-privilege replacement through the provider, update the file and restart API; verify delivery before revoking the old token. |
| `KERNEL_ASR_API_KEY` | Rotate at the ASR provider, update the file and restart the ASR/API runtimes that consume it; test an authorized transcription before revocation. |
| `KERNEL_MODEL_API_KEY` | Rotate at the model provider, update the file, regenerate deep-agent.env through reviewed deploy and restart API/deep-agent; verify an actual model response before revocation. |
| `MODEL_CREDENTIAL_KEY` | **Changing this key makes previously stored encrypted model credentials unreadable.** Inventory affected credentials first. Re-enter/re-encrypt every stored credential under the replacement key using the supported administrator flow; update the file and restart API in a coordinated window. Do not merely swap the key and claim rotation complete. |
| Other provider/session keys, including `LANGSMITH_API_KEY` | Inventory actual consumers and provider revocation rules; update protected files, regenerate derived env files, restart consumers, and verify before revocation. |

After any rotation verify that no old values remain in derived env files, artifacts,
or bounded diagnostics. Deploy/provision changes need the reviewed trusted-script
installation workflow before use: merging does not replace the root-owned copy.
Failure recovery must coordinate provider/database and file values; reverting only
one side is not a rollback. The argv regression tests use synthetic secrets and do
not prove production credentials have been rotated or old logs deleted.
