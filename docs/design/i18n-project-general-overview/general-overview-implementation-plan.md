# General project overview implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Reuse this WT; no new agents or per-task reviews.

**Goal:** Render the complete existing general-project overview in current zh-CN/en without changing requests or domain facts.
**Architecture:** Typed additive overview namespace and narrowly locale-aware shared display helpers. Preserve API facts/raw data and hook dependencies; render errors in current locale from their original causes.
**Tech Stack:** React/TypeScript, existing I18nProvider, Vitest/testing-library, canonical seeded Playwright.
**Spec:** docs/design/i18n-project-general-overview/design.md; GitHub6258.

## Global constraints
- One issue/PR for this full page; no workshop/destination/creation/API changes.
- Stable IDs/filter keys/raw names/counts/hrefs; locale never refetches/writes/retries.
- Fresh FIRST+ROOT sole grants per heavy/normalcommit/push, actual exit and own cleanup before dual-release.
- Canonical retries/timeouts/assertions unchanged; raw evidence private0700/0600, safe allowlist only.

## Review focus
- Stored failures need current locale after resolution without adding locale to request dependencies.
- Optional date/category locale interfaces preserve every old default-ZH caller and stable enum keys.
- Knowledge succeeds/reasoning fails retains real claims with conflict unknown, not invented zero.
- Independent member/content/brain permission errors preserve actual existing access.
- Unknown caller/user/model text and raw entry titles never enter translation matching.

### Task 1: Complete page projection and provider invariants
- [ ] Read task brief and freeze baseline; add provider counterexamples against actual TabGeneralOverview and existing shared index with typed fixtures.
- [ ] Obtain fresh sole; run one new suite to observe genuine missing-English RED, distinguish fixture failure; release.
- [ ] Add minimal typed display namespace and render-only locale projection, preserve callback/effect dependencies and raw data.
- [ ] Fresh window: new provider suite plus existing project-workbench-non-workshop and directly affected helper/resource tests; resources/type/scopedlint. Stop first unexpected failure; release before diagnosis.
- [ ] Normal precise checkpoint of safe source/tests/docs/evidence under fresh window.

### Task 2: Real route acceptance and delivery
- [ ] Reuse canonical seeded auth/project helpers, register exact new spec in existing config; verify exact selection/source provenance under a fresh window.
- [ ] Main-selected real browser lane, 375/1280/current locale/reload/errors/access, no mock route substitution; inspect every PNG, retain failures, clean own scope before analysis.
- [ ] One final independent branch review; fix actual scoped findings with RED→GREEN and necessary checks only.
- [ ] Normal scan/hooks/push PR Closes6258/develop, author handles first source/candidate FAIL, main sole queue/merge; update precise coverage and continue next full authorized flow.
