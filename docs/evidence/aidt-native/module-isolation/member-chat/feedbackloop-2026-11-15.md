# Member text communication feedback loop — 2026-11-15

Baseline inspected: `c616680c5`. This records three actual code/test findings, not ten claimed UI review rounds. Native screenshot review is coordinated separately by QA.

| Finding and failing evidence | Fix | Validation |
| --- | --- | --- |
| The nonmodal discussion panel listened on document for Escape regardless of focus. An Escape from another page tool closed it. Safari IME Escape (`isComposing:false`, `keyCode:229`) also closed it. Both actual-launcher counterexamples failed. | Limit Escape to events originating in the panel/trigger (including document simulation when panel owns focus), and reuse the shared composing guard. Preserve normal Escape close and focus return. | Both new launcher cases pass; existing close/reopen, route persistence, access-list error/retry and actor-change tests still pass. |
| A delayed topic read retained `busy` across a project switch. After returning and completing new project authorization, its old response was ignored but no fresh topic read was started. The actual-controller counterexample remained loading with only one topic request. | Topic requests receive AbortSignal and per-request identity. Cleanup on visit/topic/activity/visibility changes clears only the cancelled request; late results/finally cannot modify a later request. Opening a topic is owned by its effect, avoiding duplicate starts. | The interrupted request signal is aborted, returning starts a second read, new replies render and the stale reply is absent. |
| A slow earlier-history response overwrote newer delta thread metadata. The counterexample first displayed five replies from sequence105, then regressed to one from delayed sequence50. | Merge thread activity only when its `lastSequence` is at least the stored activity sequence, for both delta and history pages. | Five replies remain displayed after the old response arrives. |

Before logs: `/tmp/aidt-member-feedback-before.log` (three failing assertions: two Escape cases plus metadata regression), `/tmp/aidt-member-topic-interrupt-before.log` (the interrupted-topic counterexample).

After command:

```sh
pnpm --filter web test tests/ui/project-member-chat.test.tsx tests/ui/project-member-chat-launcher.test.tsx tests/live-project-member-chat.test.ts tests/ui/team-text-conversation.test.tsx
```

Result: **43/43 pass** (controller21, launcher6, adapter10, preview6). `/tmp/aidt-member-feedback-after.log` records this run. A subsequent focused interrupted-topic run also passed with an explicit abort assertion (`/tmp/aidt-member-topic-interrupt-after.log`). Targeted ESLint and `git diff --check` passed. Root coordinates the single workspace typecheck; no duplicate full check was run here.

No API contract, production service, voice feature, permission, deployment or public publishing changed. HTTP/session are mocked in these tests; fresh real service and browser acceptance remain QA's separate evidence. The existing in-memory draft durability boundary and foreground five-second polling remain unchanged.
