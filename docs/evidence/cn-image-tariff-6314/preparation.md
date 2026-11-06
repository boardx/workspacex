# CN image tariff activation preparation — #6314

## Boundary and live diagnosis (2026-11-06)

The human explicitly chose **prepare only; do not enable the account**. Nothing in
this document authorizes a production role, credential, deployment or tariff write.
CN image generation is not fixed or accepted yet.

Read-only checks through the authenticated CN ECS Workbench found:

- API and Agent revision: `d3ddb57ca6c6ecfda140562ba226120649bdb5ed`.
- `credit_global_image_schedule` row count: 0. The current resolver requires this
  schedule; it has no organization/legacy fallback.
- API `BILLING_TARIFF_DB_USER` and `BILLING_TARIFF_DB_PASSWORD`: absent.
- `app_billing_tariff_writer`: NOLOGIN, no superuser/create-role/bypass-RLS/inherit.
- Enabled CN credit catalog: 7 entries. This count does not validate the pricing basis.
- Internal image endpoint reached authentication/validation (invalid-body probe 400).
  No provider generation was dispatched by that probe.
- API envelope uses `error`/`traceId`; the bridge expects `message`, hiding diagnostic
  detail. Generic assistant claims of a provider outage are not proof of one.

Devapp's visible chat contains rendered images and downloadable attachments. It is
an execution reference, not authorization to copy its credentials or tenant tariffs.

## Prepared code

Deployment input supports an explicit capability:

```json
{"provision":{"billingTariffProfile":{"passwordSecretRef":"file:/etc/workspacex-cn/billing-tariff-password"}}}
```

This is a fragment to merge into the existing validated deployment input, not a
complete replacement. The private path is proposed, not installed. The profile
projects the fixed `app_billing_tariff_writer` identity and secret only into API.
Absence leaves writes unavailable. Missing/short/overlong/CR/LF/NUL/padded values
and reuse of app/diagnostics/migration passwords fail closed. It does not create
or enable a database role or generate/rotate any of the 12 stable secrets.

The activation CLI additionally permits exactly `https://app.workspacex.cn/api`
(with optional trailing slash). Devapp remains the default. HTTP, other hosts,
credentials, query/hash, other ports and arbitrary prefixes remain rejected;
requests never follow redirects. The existing authenticated global CAS, catalog
recheck, audit and independent readback remain in use.

## Future execution, only after explicit authorization

1. Freeze an approved merged SHA and snapshot the current configuration, exact
   container digests and global schedule/audit revision. Use the existing release
   lock and canonical cloud release/configuration lane. Do not edit a live
   container's environment or run bare Compose as a shortcut.
2. An operator creates the dedicated private password file (root owned, mode 0600,
   no newline or surrounding whitespace). Never put its value in argv, chat,
   issue, logs, Git or a workflow input. Do not copy Devapp credentials.
3. The separately approved provisioning job uses the same private file via
   `BILLING_TARIFF_PASSWORD_FILE` and the existing
   `apps/api/scripts/provision-billing-tariff-writer.ts`, with migration identity
   confined to that job. This enables LOGIN: it is NOT part of this preparation.
   Do not grant memberships, superuser, bypass-RLS or application-role writes.
4. Separately prepare/install and verify the frozen trusted host renderer/control
   tools and validated private configuration through the approved configuration
   lane. The current image-release consumer has no checkout and does not install
   this renderer merely by deploying application images. Current host tool/input
   readiness has NOT been established. Any new root entry or private input copy
   requires its exact approval; do not silently expand an installed policy.
   Then validate the deployment input/schema and generate the API runtime using
   the profile above. Activate through the reviewed canonical lane with identity,
   lock, snapshot and readiness checks. No credentials enter Agent/Web/bootstrap.
5. Obtain an existing CN platform-operator session token through the normal login
   flow, store it privately, and establish the read-only quote organization ID.
   Confirm supplier/account region is actually cn-beijing before declaring it.
   On the trusted cloud execution host with the frozen source and dependencies:

   ```bash
   export QWEN_ACTIVATION_BASE_URL=https://app.workspacex.cn/api
   export QWEN_ACTIVATION_REGION=cn-beijing
   export QWEN_ACTIVATION_QUOTE_ORG_ID='<verified CN quote context>'
   export QWEN_ACTIVATION_TOKEN_FILE='<private existing operator token file>'
   pnpm --filter @repo/api exec tsx scripts/activate-qwen-image.ts --fixed-prices
   ```

   Dry-run must show the live CN catalog version and all three fixed customer
   prices. Operator verifies these using the current global-price contract;
   credit conversion is computed from the live CN catalog, never copied from
   Devapp. The quote organization is not a tariff scope.
6. After reviewing the dry-run, the separately authorized activation adds
   `--apply` to that same command. A quote/revision conflict or uncertain response
   requires reconciliation by GET/audit, not blind retry or a direct SQL insert.
7. Record the returned global revision and audit evidence without private data.
   Run one real CN chat generation, verify the image renders and downloads, and
   reconcile its unique provider request, credit receipt and artifact. Inspect
   any further failure before retrying; missing tariff was a confirmed blocker,
   not proof that every other dependency is healthy.

## Failure / recovery limits

Before the authenticated PUT, preview and configuration validation do not change
schedule data. A runtime activation failure uses the canonical previous bundle
and exact-image recovery. If a PUT may have succeeded, preserve audit evidence
and read back before further action. Runtime rollback does **not** delete or
restore a database schedule. There is no reviewed public operation to restore an
initially empty schedule; do not claim automatic database rollback, delete audit
rows, or invent destructive SQL. Stop and prepare a separately reviewed recovery
if that boundary is reached.

## Validation

- Runtime/config: 43 passed on the final change; bundle/host: 29 passed.
  `pnpm --filter @repo/cloud-deploy lint` passed (typecheck + schema freshness).
- Runtime/config/bundle/host tests exercise service separation, TLS continuity,
  strict profile parsing, credential rejection and existing deployment behavior.
- Image suite: 12 files, 110 passed via `vitest.image.config.ts`.
- The image suite exercises constrained origins, authenticated global CAS,
  readback/conflict handling, pricing and image admission. Its HTTP responses
  are fixtures; it does not prove CN generation or billing acceptance.
- `./init.sh` completed successfully (quick path; not a full repository test run).
- `pnpm harness tick` could not run because COORD_GATEWAY_URL is not configured.
  Readiness/active-features projections were refreshed; this direct user incident
  is intentionally outside the readiness queue.

## Latest execution boundary

The human reiterated: no new accounts; add missing configuration first. No role
or credential was created/enabled. The missing profile is prepared in source;
no usable dedicated credential has been established on the live API.

Independent read-only review of `55e008df26e718268d23f304f648b40b8f1c3b18`
found no blocking code/credential-isolation issue. It requested the host-tool
clarification above. CLI `quoteSource` still says `live-devapp-catalog` for CN;
verify the explicitly selected validated origin rather than treating that old
label as environment evidence.

Push verification was interrupted after 11m39s during extreme local load (~400).
Turbo reported 27/29 successful tasks, and its interrupt exit unexpectedly allowed
the push. This is NOT full typecheck/lint success; API/Web typechecks remain
unconfirmed. No `--no-verify` was used. Retain the draft boundary and require CI
before merge or tool installation. No owned test/deployment processes remain.
