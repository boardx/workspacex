# Unified release implementation plan

> Execution: implement inline using superpowers:executing-plans, then independent whole-change review.

Goal: one manually invoked Compose release flow and understandable server layout for devapp/CN/US.
Architecture: one installed orchestrator, one ledger-based migration driver, environment-only configuration, existing registry builder and exact-image checks.
Tech stack: Python 3, Node.js/pg from candidate API image, Docker Compose, GitHub Actions.
Spec: ../specs/2026-11-03-unified-release.md

## Constraints and review focus
Preserve mounted data/keys/current and previous versions. No automatic publish. No untracked SQL replay. Config rollback accompanies image rollback. No production acceptance claims from fixtures.

- [x] Test and implement generic migration plan/apply/reconcile, committed-name skipping with historical drift reporting, and per-file atomic ledger commits in scripts/unified-migration-driver.mjs. Run node --test tests/unified-migration-driver.test.mjs.
- [x] Test and implement shared host orchestration, canonical lock, layout, private logs, complete image pull, config validation, backup, SQL, switch, runtime readiness, atomic state and rollback. Run Python subprocess/fault tests.
- [ ] Wire every environment to the same installed entry and manual workflow; test selected-branch builds and tag reuse, with no environment-specific algorithm.
- [ ] Inventory three hosts through Workbench, retain referenced data/config/tools, migrate configuration and verify real release + rollback before deletion.
- [ ] Review exact SHA, PR checks green, record host evidence and remaining limitations in #6187.

Local evidence: 17 Python + 7 Node fault tests passed; real disposable PostgreSQL16 per-file commit/retry/lost-COMMIT acceptance passed and container removed. 29 planner CLI tests and 82 workflow contract tests passed. Review accepted bc3dfa4880ba0d3155810a272547753466b3d1ee for initial shared engine with production acceptance explicitly pending. Later workflow changes require review of the new head.
