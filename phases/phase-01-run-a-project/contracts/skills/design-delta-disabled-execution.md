---
base_bundle: skills
issue: 2529
record_kind: merged-implementation
---

# Design delta · disabled Skill executable content (#2529)

This record attaches to the `skills` bundle and documents the execution-time
revocation behavior merged in PR4930 (`95e36a337`). It records implemented behavior
and its acceptance tests; it does not assert a new human signoff or change the
bundle's signoff fields.

## Snapshot and revocation semantics

Message acceptance records immutable, ordered `agent_runs.skill_version_ids`:
agent pins (or enabled organization defaults when there are no pins), followed
by active thread mounts, with duplicate versions removed. Disabling a Skill
does not rewrite an Agent version, remove a mount, or edit any historical run
snapshot. Pin and mount write behavior is unchanged.

At execution, `PgAgentRunRepository.readPinnedSkills` is the shared executable
content reader. Its SQL requires both a published version and the parent
Skill's current `status = 'enabled'`, for organization and platform-owned
Skills alike. This single reader applies to every source in the run snapshot.
Default selection already excludes disabled Skills; existing pins and mounts
can still record their version IDs, but cannot bypass this execution gate.

If any selected body is unavailable, the existing executor cardinality guard
fails the **whole run** with `SKILL_VERSION_UNAVAILABLE` during `context_built`,
before building or sending a model prompt. It does not silently drop the Skill
or call the provider with the remaining enabled subset. This includes a Skill
disabled before message acceptance and one disabled after acceptance while the
run is still queued. The gate checks status when content is read; it does not
cancel an already-running provider invocation after a later disable.

Re-enabling makes the same published body available to a subsequent run.
Previously failed runs remain failed with their original version IDs. No
automatic retry or snapshot repair is introduced. No new API field or error
code is added, and this delta does not decide whether pin writes should reject
disabled Skills or add dependent-Agent warnings.

## Executable acceptance

- `apps/api/tests/agent-runtime/no-tool-run-writeback.test.ts`, `#2529` cases:
  real-PG catalog plus HTTP message acceptance and a real loopback provider;
  pinned and mounted sources, each disabled before and after acceptance.
  Assert ordered snapshot IDs survive, the whole run fails with the existing
  code, zero provider calls suppress all prompt content, re-enable restores
  both complete Skill bodies in the next system prompt, and the historical
  failure remains unchanged. The mounted case keeps another enabled Skill
  pinned, so silently dropping the mount cannot satisfy the test.
- `apps/api/tests/agent-runtime/pinned-skill-package-real-db.test.ts`, `#2529`:
  shared executable reader returns no disabled package and restores it after
  re-enable; package integrity and immutable version selection remain covered.
- `apps/api/tests/skill/thread-mount-run-injection-real-db.test.ts` and
  `apps/api/tests/chat/thread-mount-run-snapshot-union.test.ts`: mounted source
  reachability, snapshot union, ordering, and deduplication regression coverage.

Run through the standard isolated wrapper with the existing API Vitest config:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/no-tool-run-writeback.test.ts tests/agent-runtime/pinned-skill-package-real-db.test.ts tests/skill/thread-mount-run-injection-real-db.test.ts tests/chat/thread-mount-run-snapshot-union.test.ts --maxWorkers=1 --minWorkers=1
```

Counterproof: removing only PR4930's `sk.status = 'enabled'` predicate makes the
four `#2529` run cases fail: disabled bodies reach execution instead of causing
`SKILL_VERSION_UNAVAILABLE`. Restore the predicate for the green regression run.
