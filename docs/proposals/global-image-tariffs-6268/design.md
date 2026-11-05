# Global native image tariffs — #6268

Status: implementation locally verified; production activation has not been performed. See docs/evidence/global-image-tariffs-6268/verification.md.

## Behavior
All existing and future organizations use the same three image prices: Z CNY0.25, Qwen3 CNY0.50, Pro CNY1. Personal and eligible team payers use the common reserve transaction. No synthetic organization or organization initialization is required. Existing wallet eligibility, balance and overdraft rules remain authoritative.

## Storage and resolution
Add platform-scoped global tariff rows keyed by provider/model/unit and append-only global change audit. Global rows carry exact fixed customer CNY micros, quoted credit rate, catalog basis/version and tariff version. For the three unified image models global resolution takes precedence over legacy organization rows. Unknown image models/units and missing global prices reject before dispatch. Nonimage legacy tariffs retain current behavior.

Resolve within reserveInSession, after payer selection. Persist wallet_id, tariff_version, native_quantum and native_rate with the reservation. Existing request replay uses its persisted wallet/rate; settlement never queries the current global price. Updating a price affects only new requests.

## Operator contract
Platform-operator-only GET /platform/billing/consumption/global-native-tariffs lists explicit global rows. PUT on that path accepts only expected prior schedule revision and expected live CN catalog version, atomically activating all three server-owned model/price pairs. Server derives credit hundredths from fixed customer CNY amounts using the existing live CN catalog basis and integer ceiling. Atomic compare-and-swap updates the tariff and appends actor/old/new/basis audit. No caller-supplied orgId or unchecked credit rate. Missing/ambiguous CNY basis and stale versions reject without writes. US storefront currency does not supply an invented FX conversion.

## Compatibility and rollout
Additive migration only. Preserve all old organization rows and their audits. Known temporary activation versions are recorded as superseded in an append-only audit at global activation; do not delete unknown customer overrides. Unified image resolution always uses the global row, so retained legacy rows cannot silently override global prices. List legacy rows as historical for those model identities. Global activation is a distinct audited operator action, after deployment and quote readback; no direct SQL population or per-org batch copies.

## Verification matrix
- Existing and new org with zero org tariff rows reserve all three image models.
- User and eligible team payer pay the same price while retaining wallet/overdraft rules.
- Legacy temporary 10x rows cannot override global price; unknown legacy rows remain stored.
- Unknown model/unit and missing global row produce zero supplier dispatch.
- Nonoperator cannot read/write platform tariffs; CAS and audit are atomic.
- Price update between reserve and settlement preserves old snapshot; replay yields one debit.
- Missing/ambiguous CN basis and stale quote produce no writes; CN basis works independently of US storefront.

Run real isolated PostgreSQL tests for transaction, RLS, replay and ledger assertions; mocks alone do not establish these invariants. Run relevant API/contracts typecheck and targeted route/admission tests. No production paid retry is part of code verification.

## Design gate
UI: no new end-user UI; existing operator API is extended with explicit global scope. Use cases/API above are review material. Human signoff has not been recorded; an agent must not mark it approved. Implementation verification is recorded in the evidence log; production activation remains pending.

## Concrete schema and runtime patch map
GET response: `{scope:"global", revision:string|null, items:[{modelProvider:"bailian-image", modelId:"z-image-turbo"|"qwen-image-3.0"|"qwen-image-3.0-pro", unit:"image", customerAmountMinor:"25"|"50"|"100", currency:"CNY", quantum:"1", hundredthsPerQuantum:string, version:string, catalogVersion:string}]}`. Fixed model/amount correspondence is server-owned, not arbitrary caller pairing.
PUT request: `{expectedRevision:string|null, expectedCatalogVersion:string}`; atomically activates the complete three-row schedule, not partially configurable rows. Response is the same GET snapshot. Authentication resolves operator identity from the existing principal, never a caller actorId. Stale revision/catalog is HTTP409; missing/ambiguous basis HTTP503; nonoperator HTTP403. Repeated same request with now-stale revision returns409 without another audit mutation.

Migration constraints: one global schedule revision row; unique(provider,model,unit); positive bounded integer quantum/rate, fixed CNY model/amount CHECKs; audit includes actor, before/after schedule, source catalog and timestamp. Platform writes use the existing privileged operator repository boundary; tenant reserve reads only approved schedule rows, never unrelated tenant data. Test the actual database-role access; do not merely add a table outside RLS and assume it is safe.

Patch locations: `packages/contracts/src/billing-consumption.ts` (global contracts); `application/billing/native-credit-tariff-service.ts` (operator authorization/quote); `infrastructure/billing/pg-native-credit-tariff-repository.ts` (global transaction/audit); consumption controller routes and module injection; additive migration; `infrastructure/billing/pg-credit-consumption.ts` (common native resolution). Extract a resolver if needed to avoid duplicated precedence rules. Existing settle/replay stays snapshot-driven.

Planned targeted files: `tests/agent-runtime/global-image-tariff-service.test.ts` for operator/CAS/quote behavior; `tests/billing/global-image-tariff-pg.test.ts` for real PostgreSQL payer/reservation/audit/role counterexamples. Implemented test commands and results are recorded in the evidence log; the original planned command was: `pnpm --filter @repo/api exec vitest run --config vitest.image.config.ts tests/agent-runtime/global-image-tariff-service.test.ts`; real-PG command must use the repository's isolated database harness after resource admission; API and contracts typecheck through normal pre-push. The evidence log records actual results and earlier failures; CI remains separate.

Review decision package: approve an explicit global, atomic three-model fixed-price schedule API with global precedence for those models, preserved legacy rows and immutable old request prices. No unresolved price or FX choice is requested. The repository root AGENTS hard constraint says a contract bundle must have human signoff before feature work; `.harness/instructions/contract-design.md` lines265-277 specify pending review then human confirmation and the claim gate, lines279-282 protect status. This draft does not assert that gate has passed. Coordinator should bind this material into the applicable contract bundle and obtain the single required design confirmation; do not ask again about already-authorized prices.

An active schedule must have one shared catalogVersion across all three rows. Individual row tariff versions need not equal the schedule revision.
