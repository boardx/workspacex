# WX-E004 API complete skill package verification

Scope: existing `skill_version_files` reads and trusted `config.configurable.org_skills`
transport. This evidence does not claim Python mounting, sandbox execution, or end-user
artifact generation is complete. No alternative skill storage or frozen POST route was added.

## Executed verification

From the repository root:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/pinned-skill-package-real-db.test.ts tests/agent-runtime/deep-agent-resume-forwards-skills.test.ts tests/agent-runtime/trial-run-agent.test.ts tests/agent-runtime/no-tool-run-writeback.test.ts tests/agent-runtime/agent-skill-pins-http-route.test.ts tests/skill/thread-mount-run-injection-real-db.test.ts
```

Observed result: exit 0, **6 files / 62 tests passed**, Vitest duration 19.21 seconds.
The isolation wrapper reported database `wsx_94b61edfa46206f86000`, Compose project
`wsx-94b61edfa46206f86000`, peak 9 database connections, and completed cleanup.
The raw Vitest output was returned through the execution tool and was not saved to disk;
these numbers are a transcription of that output, not a substituted raw log.

The new tests check complete SKILL.md/reference/script/binary asset reads, byte-for-byte
binary preservation, SHA256 integrity, the pinned historical version despite a newer
published version, platform access, rejection of another organization's version and a
draft, corrupt-file rejection, and identical fresh/resume package forwarding outside
model messages. Existing tests cover legacy skill consumers, run writeback and pin routes.
Two existing fixture digests were changed from dummy values to the actual SHA256.

An initial two-file run exposed a missing platform organization in the new fixture;
after fixing fixture setup, the two files passed all 8 tests. The final six-file run
above includes the final conflict-safe platform fixture. A bare Vitest attempt was
rejected by the repository's isolation guard before any test ran; all reported passes
use the isolated wrapper.

## Typecheck limitation

From `apps/api`:

```sh
pnpm exec tsc --noEmit --pretty false
```

Observed exit 2. The complete output is [typecheck.txt](./typecheck.txt): 133 errors,
all in `packages/fabric-markdown` (69 `fabric-objects.ts`, 54 `mermaid-parser.ts`,
9 `interactions/mindmap-editor.ts`, 1 `diagrams/registry.ts`), concerning missing DOM
types and consequences. No error references the E004 API implementation or tests.
This is a recorded unresolved typecheck limit, not a passing typecheck claim.

`git diff --check` passed for the modified tracked E004 API/test files.
