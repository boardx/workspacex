# Agent / Skill unified administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Organization/private and platform/public Agent/Skill administration with a single discoverable entry per scope and consistent image cards.
**Architecture:** Preserve existing entity kinds and versioned workflows. Explicit guarded platform operations must carry a target tenant; public publication and per-organization enablement are persisted independently, without fabricated membership or principal impersonation. Organization lists and runtime eligibility respect organization enablement.
**Tech Stack:** TypeScript, NestJS, PostgreSQL/RLS, Zod contracts, Next/React, Tailwind, Vitest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-08-agent-skill-admin-design.md

## Global constraints
- Reuse current worktree, latest fetched develop, issue6418, one PR to develop.
- Organization administrator manages; ordinary member browses/uses enabled content.
- Platform public published content automatically discoverable; organization administrator enables before member use. Organization private content stays within its organization.
- Preserve published version pins, publication checks, identity isolation, tool/model grants and audit actor.
- Public/private scope must be server-enforced, never inferred from UI labels.

## Review focus
- Forged target organization/entity identifiers must not let ordinary users cross tenant boundaries.
- Public draft/unenabled content must never leak into execution candidates.
- A late response or callback after organization switching must not change new-scope state.
- Same entity ID across scopes must not select or mutate the wrong card.
- Old production directory types and task entry links must remain discoverable.

## Tasks

### 1. Server administration, public publication and enablement
Ownership: packages/contracts plus apps/api controllers/application/infrastructure/migrations/tests for new scoped catalog management. Existing platform organization and guard are single sources.
- [ ] Trace existing entity creation/publication/import and RLS before selecting implementation; record decisions.
- [ ] Add failing contract and real HTTP/PG tests: platform nonmember target management, ordinary platform denial, private isolation, public draft invisibility, published discovery, admin-only enable, unenabled execution denial, immutable version linkage, audit.
- [ ] Implement bounded scoped catalog operations, public authoring/publication and persisted organization enablement using existing domain flows, keeping explicit actor and tenant.
- [ ] Run focused isolated tests and contracts/API checks; clean exact owned containers.

### 2. Shared presentation
Ownership: shared Agent/Skill card plus AgentDirectory, official panel, CapabilityCatalogScreen, SkillCatalogLive, WorkSkillCatalog production card renderers and focused UI tests.
- [ ] Regression for image/name/two-line description and detail-only ID/actions.
- [ ] Reuse ResourceCard/Avatar, same image dimensions and responsive grid; preserve task actions in detail.
- [ ] Preserve all existing entity types, official content and failure/empty states. No global unrelated card redesign.
- [ ] Run focused affected UI tests/typecheck.

### 3. Scope routes and integration
Ownership: navigation/admin metadata, route pages, scoped administration client wrapper, i18n and scope tests (root).
- [ ] Remove top-level Agent/Skill overflow entries; add organization and platform destinations.
- [ ] Keep ordinary-member discoverability without exposing unrelated administrator navigation.
- [ ] Preserve old production deep links and all Skill library/catalog/work-catalog paths.
- [ ] Integrate explicit platform/public organization target selector and backend contract, organization public-enable controls.
- [ ] Clear stale selected/detail state on scope change; test late response suppression.

### 4. Evidence and delivery
- [ ] Review exact final diff, fix findings without weakening permission tests.
- [ ] Real browser inspect all organization/platform Agent/Skill views plus narrow viewport and detail.
- [ ] Affected types/lint/tests and prepush checks, PR Closes6418, own CI until green.
- [ ] Record exact validation limits, logs, screenshots and cleanup in evidence/agent-skill-admin-6418/; no production deployment claim.
