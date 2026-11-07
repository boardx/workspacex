# AI usage summary implementation plan

Goal: Default to charts with calendar week/month grouping, drill into same-ledger calls, and show known costs without treating missing prices as zero.
Architecture: Extend the contracts and PostgreSQL summary with per-currency cost coverage and daily costs. Aggregate existing daily summaries into calendar buckets in the UI. Keep receipts immutable and never apply current tariffs retroactively.
Spec: User-approved design in this conversation, 2026-10-28.

- [x] Add regression tests for calendar boundaries, cost precision and summary/detail navigation.
- [x] Extend summary contracts and SQL with known costs per currency, priced and unpriced coverage, including failed receipts.
- [x] Add chart overview and calendar presets; preserve self scope, filters, snapshot and pagination on details.
- [ ] Run focused tests, type checks and baseline validation; open PR and track checks.

Review focus: mixed currencies must not sum; missing cost is not zero; week starts Monday; month/year boundaries; chart drilldown must intersect existing filters and same report snapshot.

Validation: web focused tests 9/9; PostgreSQL repository tests 15/15 in isolated harness stack; web/API/contracts typecheck; targeted ESLint; init.sh fast health check. Database default startup rebuilt the image and stalled; stopped only that owned build, reran using the existing local image via --no-build --pull never. Isolated stack teardown completed.

Boundary: no devapp deployment or historical fee backfill. The receipts need their original reserved price snapshot and complete usage; no guessed provider prices or fabricated settlement costs are introduced. Live missing-price root cause remains to be verified.
