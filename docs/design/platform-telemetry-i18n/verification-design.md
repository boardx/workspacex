# Telemetry real acceptance design

Canonical contracts: GET `/system/telemetry/settings`, PUT `/system/telemetry/consent`, GET `/system/telemetry/last-report`. Always consume operations methods/paths and strict schemas rather than inventing PATCH. Actual controller guards all three with PlatformOperatorGuard.

## Fixture

Reuse PLATFORM_MEMBERS_E2E actors from6234; preserve every previous actor, credential, organization membership, module-evaluation order, environment value and existing test statement. Do not fabricate authentication or seed successful consent changes/admin grants.

Add one canonical synthetic historical report source and optional seed/env wiring. Strictly parse the full history before its new SQL. Initialize consent using canonical defaults only; seeded history can describe an earlier attempted payload with an explicit failed outcome/omitted data. Derive instance ID with the existing instanceIdFromSecret helper if needed; never log/publish installation secret. No real transmission or report-sender success claim.

Pin WSX_TELEMETRY_DISABLED=1 in the isolated test API environment. The actual reporter checks kill_switch before endpoint and starts no timer/network; do not change production reporter/config/worker. Legacy seed callers without the new prefix remain unchanged. There are no existing telemetry browser cases; preserve all other canonical fixtures/cases regardless.

## Native journey

Real UI login as dedicated superuser; read/strictly validate settings and history. Keep raw response report object for JSON.stringify display comparison: schema parsing can reorder object keys, so parsed reconstruction must not become a false byte oracle.

Visit real telemetry page. Switch language through native controls in a same-context helper tab. Assert zero extra telemetry reads/writes, all four current values and same report JSON. Toggle each item via UI; exact one-key PUT/strict response, other fields unchanged, independent GET readback and reload. Establish designated operator via actual protected platform-admin API/setup, not seed or fake token; authenticate separately, verify GET/PUT and persistence. Original ordinary org admin gets actual403 for reads/PUT and readable denied panels. Revoke target via actual superuser API, then target GET/PUT403 and reload denial. Cleanup uses actual API and is distinct from expected outcomes.

Synthetic history/readback tests UI display only. No outbound network, actual sender, infrastructure outage, external model or billing claim. Component tests own loading/network/server/unknown/outcome alternatives and deterministic deferred transitions.

## Image matrix

Eight states x375x900/1280x900: initial consent EN, same consent ZH, changed consent EN, last report EN, same last report ZH, designated operator EN, ordinary denial EN, revoked target denial EN. Use dedicated focus sections, native scrolling, full relevant control/label bounds and no document horizontal overflow. JSON retains its existing internal scrolling; data is compared textually to real raw API input. Root individually reviews all16; only inspected PNGs and safe receipts become public.

Canonical entity-localization configuration stays120000ms test/20000ms expectation/workers1/retries0; no forceclick, fake auth, mutation interception, clock manipulation or larger budgets. Actual first failure is retained, classified and fixed before a scoped same-case rerun. Estimates are never termination deadlines.
