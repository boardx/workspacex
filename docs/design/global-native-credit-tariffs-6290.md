# Deployment-global native credit tariffs — #6290

One retail tariff per provider/model/native unit applies to personal and enterprise
payers and every current or future organization. Payer permissions, wallet identity,
and admitted-request price snapshots remain separate. ASR retains its approved
supplier-cost ×3 rule. Image activation uses the approved fixed CNY prices:
Z-Image 0.25, Qwen3 0.50, and Qwen3 Pro 1.00 per image, converted using the live CNY
credit catalog. Supplier geography is metadata, not automatic retail repricing.

## Schema and activation

The 2026-11-05 user instruction explicitly removes backward compatibility: old
per-organization prices and their audit are disposable test data. The migration
creates `credit_global_native_tariffs` and its append-only global audit, then drops
`credit_native_tariffs` and `credit_native_tariff_changes`. It creates no legacy
archive, compatibility view, consolidation routine, or old-runtime read path.

The global tables start empty. An authorized platform operator activates approved
global prices through the audited API. Until configured, native model admissions
fail with the existing missing-tariff error. New organizations automatically use
configured global prices without copying organization rows.

The migration is idempotent: historical replay may recreate obsolete tables, and
the final migration drops them again without changing configured global rows or
their audit. Application writes follow the existing global consumption-settings
pattern: authoritative operator checks, minimum grants, and immutable audit.

Strict API schemas reject removed `orgId` pricing fields. The UI has one global
price editor; activation uses global URLs and bodies with `--fixed-prices`.

## Release boundary

Ship the new runtime and schema together. Old application versions requiring the
dropped tables are unsupported; rollback must use a version supporting global
prices. No deployed database is changed by this PR. Existing admitted requests
retain `native_quantum`, `native_rate`, `tariff_version` and wallet identity;
settlement and replay use these snapshots. Estimated ASR usage still awaits
authoritative reconciliation.

## Verification contract

1. Both old pricing relations are absent after migration and historical replay.
2. Global operator prices and audit rows survive repeated migration execution.
3. Personal, team and new-organization admissions share prices while using separate
   wallets; settlement retains previously saved prices after a global update.
4. Nonoperators cannot configure prices; removed org-shaped inputs are rejected.
5. Organization export and exhaustive cross-tenant RLS checks pass without legacy
   object exceptions or privilege filtering.
6. Fixed-price activation, localized global tariff UI, migration rebuild/replay,
   and release recovery simulation pass. Production activation remains separate.
