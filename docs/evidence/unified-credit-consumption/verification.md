# Unified model credit consumption — verification

Tracking: Refs #5877. This is local implementation evidence, not a merchant-payment or devapp deployment acceptance claim.

## Invariants

- Each physical model request admits a persisted server-derived payer before dispatch. Organization and personal wallets stay separate.
- `credit_preflight_enabled` controls admission only. OFF still accounts for actual usage and records debt. ON reserves available funds; unresolved zero-bound consumption blocks new admission.
- Reported Token usage costs 1 credit / 1000 tokens, rounded up to 0.01 credit per physical request. Native units retain their measured units and a captured configured tariff; no invented Tokens.
- An authoritative receipt, wallet debit and consumption ledger entry commit atomically. Repeated receipts do not repeat the debit. Unknown usage retains pending liability/hold.
- Private usage-only durable receipts survive database failures; root replay writes accounting only. It never re-executes a model. VM templates use a persistent private directory.
- A model transport without enforceable accounting is denied, including opaque external Deep Research. Missing native tariff or required maximum bound is an accounting error, never a free call.

## Two review iterations

First: inventory TypeScript ModelCallPort callers, direct provider HTTP/WebSocket transports and private Python model/embedding/rerank transports; check trusted attribution and mandatory accounting independent of legacy AI-quota switches.

Second: exercise actual HTTP + PostgreSQL debit, replay, unknown usage, database/spool failures, native Token/native-unit selection, OFF→ON transition, background attribution and preservation of financial errors through product adapters.

Defects found and corrected during these iterations:

1. Auxiliary HTTP model requests were excluded by request-start identity constraints.
2. Attachment VLM used a direct HTTP transport outside the shared model gateway.
3. Background knowledge/indexing, attachment extraction and digital interviews lacked persisted payer context.
4. Private-runtime admissions omitted durable receipt-spool capacity/health checks.
5. Known Token usage from native image requests could remain pending while waiting for image quantity.
6. Auxiliary UI adapters could replace financial refusals with generic model errors/fallbacks.
7. Legacy payment tests assumed integer PostgreSQL balance fields; migrated values preserve hundredths and debt.

## Verified local commands

All API database commands use `.harness/scripts/with-test-isolation.ts`; they do not connect to the shared development database.

| Area | Command/fixture | Observed result |
| --- | --- | --- |
| Payment and credit API | `pnpm --filter @repo/api exec vitest run tests/billing --maxWorkers=1 --minWorkers=1` | 272 tests passed in the combined final billing/KG run, including native-priority and spool-admission amendments |
| Real model transport and database | `tests/billing/credit-model-pg.integration.test.ts` | Zero balance + ON makes zero HTTP requests; funded 11 reported Tokens debit 0.02 credit; receipt replay leaves one debit, one receipt and one provider request |
| Financial and durable receipt edge cases | `credit-consumption-pg.test.ts`, `durable-credit-usage.test.ts` | 27 tests passed, including actual Token usage on an image request, independent hold/debt counters and durable storage outage/replay |
| Auxiliary research/design/canvas | `tests/billing/credit-auxiliary-errors.test.ts tests/research tests/design-workbench tests/canvas tests/survey/generate-markdown-proposal.test.ts` | 131 files / 2004 tests passed |
| Settings, native prices and knowledge extraction | Settings HTTP/PG, native tariff PG, credit error/context/run-code, extraction-agent and ingest-project-evidence tests | 45 tests passed |
| Payment recovery and project attribution | Schema migration, WeChat crediting/outcomes, project-ingestion-credit-subject | 36 tests passed |
| Background attachment/interview ownership | Attachment worker/repository/wiring and real PostgreSQL digital workflow tests | 33 tests passed |
| Knowledge embedding ownership | `knowledge-embedding-accounting.test.ts` | 9 tests passed; personal/project scope, forgery/stale source/revocation and real private HTTP protocol |
| VLM/gateway boundary | Dedicated VLM and credit gateway unit lane | 20 tests passed before final private-runtime amendment |
| Billing UI | `credit-consumption.test.tsx`, `billing-overview.test.tsx`, `billing-cashier.test.tsx`, `billing-subscription-live.test.tsx` | 91 tests passed |
| Routing | `lint:rewrite-coverage`, `lint:contract-route-coverage`, `lint:body-path-param-leak` | Passed; no new route/proxy gap or shadow |
| Recovery migration suffix | `tsx --test tests/fixtures/cn-application-recovery/migration-scope.test.ts` | Passed |

## CI regression repairs — 2026-10-23

The initial seven failing checks were repaired without weakening admission: financial fixtures now persist payer/start facts; the private browser fixture forwards its real callback address/key; the deploy-env backfill remains free of provisioning side effects; local accounting guidance points to local settings. On head `47d49eb47`, 39 remote checks passed and only the full-stack browser suite failed (189 passed, one imported-Agent trial failed for missing non-chat private ownership).

The additional private auxiliary operation path is covered by 15 passing API gateway/real-HTTP/PostgreSQL tests (`/tmp/credit-private-aux-complete.log`) and 83 passing Python physical-accounting tests (`/tmp/credit-aux-python-final.log`). They verify zero vendor HTTP with zero balance in strict mode, actual 11 Token usage producing one 0.02 credit debit in permissive mode, immutable replay identity, tenant/model/payer rejection, expiry/closure, late settlement and trusted recharge guidance. This evidence does not establish a real merchant charge or deployment.

The exact failed browser journey also passed against a fresh production Next/API/PostgreSQL stack: GitHub Agent import → edit instructions → publish → trial response (`/tmp/5894-aux-trial-browser-serial.log`, one test passed, actual browser journey 7.7 seconds). A local-only startup budget accommodated the measured 11-minute cold build; CI configuration and browser assertions were unchanged.

The auxiliary migration was then checked with the production `migrate:check` command from an empty isolated database: schema rebuild and individual migration replay both passed (`/tmp/5894-aux-migration-check.log`). The unique binding, tenant policies and both metadata tables remain enforced on replay.

Non-model interview/research browser flows now register their own real organization and verify zero runs/physical requests before and after editing; concurrent legitimate calls in the shared seed organization cannot corrupt this assertion. Three focused production browser flows passed (`/tmp/5894-no-model-flows-browser.log`); the extra GitHub import control hit `IMPORT_FETCH_TIMEOUT` after an earlier passing control run. Supplemental research R2/R3/R4 checks passed. The separately enabled R5 report-text assertion fails identically with the original HEAD fixture (`/tmp/5894-research-r5-original.log`): an extra source-progress label remains visible. Its assertion and report implementation are unchanged; this is not full report UX acceptance.

## Configuration and rollout

The default preflight policy is OFF; configure it in platform operations (`/platform-admin/ops-status`). Native tariffs are operator-managed for each organization/provider/model/unit and recorded in an append-only audit. No default commercial price is invented.

For native image models reporting Token usage, strict preflight requires a trusted conservative `KERNEL_IMAGE_MAX_BILLABLE_TOKENS` bound. Attachment VLM strict preflight requires `KERNEL_VISION_MAX_INPUT_TOKENS`, combined with the enforced output cap. If unavailable, strict mode refuses dispatch. OFF still records actual reported usage.

Before deployment, provision the persistent receipt directory as documented in `deploy/credit-consumption-recovery.md`. This branch does not write server secrets, execute merchant charges, merge its PR or deploy automatically.
