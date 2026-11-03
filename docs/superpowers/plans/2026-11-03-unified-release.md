# Unified release implementation plan

> Execution: implement inline using superpowers:executing-plans, then independent whole-change review.

Goal: one manually invoked Compose release flow and understandable server layout for devapp/CN/US.
Architecture: one installed orchestrator, one ledger-based migration driver, environment-only configuration, existing registry builder and exact-image checks.
Tech stack: Python 3, Node.js/pg from candidate API image, Docker Compose, GitHub Actions.
Spec: ../specs/2026-11-03-unified-release.md

## Constraints and review focus
Preserve mounted data/keys/current and previous versions. No automatic publish. No untracked SQL replay. Config rollback accompanies image rollback. No production acceptance claims from fixtures.

- [ ] Test and implement generic migration plan/apply/reconcile, checksum checks and per-file atomic ledger commits in scripts/unified-migration-driver.mjs. Run node --test tests/unified-migration-driver.test.mjs.
- [ ] Test and implement shared host orchestration, canonical lock, layout, private logs, complete image pull, config validation, backup, SQL, switch, health/browser, atomic state and rollback. Run Python subprocess/fault tests.
- [ ] Wire every environment to the same installed entry and manual workflow; test selected-branch builds and tag reuse, with no environment-specific algorithm.
- [ ] Inventory three hosts through Workbench, retain referenced data/config/tools, migrate configuration and verify real release + rollback before deletion.
- [ ] Review exact SHA, PR checks green, record host evidence and remaining limitations in #6187.
