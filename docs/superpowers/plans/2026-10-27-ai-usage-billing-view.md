# AI Usage Billing View Implementation Plan

> Execute inline with superpowers:executing-plans. User approved the bill-style design in chat.

**Goal:** Show when each model was called and how much was consumed without exposing internal identifiers.
**Architecture:** Keep ledger contracts, forced-self scope, snapshot and cursor semantics. Separate presentation helpers and ledger table from fetch/filter state. Reuse member names and existing UI primitives.
**Tech Stack:** React, TypeScript, shadcn primitives, Vitest.
**Spec:** User-approved design: today/7 days/month/custom dates in Beijing time, calls and recorded usage overview, date-grouped calls and model summary tabs, collapsed cache/reasoning details, no default UUIDs, unknown is not zero.

## Constraints and review focus
- No permissions, API, pricing or ledger writes change.
- Missing aggregate cost must not become a fabricated page-only total.
- Unknown and native units must remain distinct from actual zero token usage.
- Date end is inclusive in the UI and exclusive in the API; date conversion uses Beijing time.
- Pagination shares summary.asOf, and personal scope cannot be cleared.
- Name lookup failure must not expose IDs; organization changes must clear cached presentation.

## Tasks
- [x] Write regressions for readable dates/models, unknown vs zero, scope, pagination, native units and filters; observe failure.
- [x] Implement date/quantity formatting helpers and date-grouped ledger table with optional member names and expanded metering details.
- [x] Replace the panel with concise summaries, date presets, model selection and model summary tab; improve page introduction.
- [x] Run UI tests, typecheck, lint/design checks and browser layout verification; record evidence.
- [ ] Create linked PR and follow CI/review to completion.
