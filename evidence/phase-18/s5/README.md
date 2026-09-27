# Round S5 — #4360 「关于我」 + #4362 opening briefing / 续上, real browser, real local stack

Branch `s5` (from `8f30e70ff`, r11a + origin/main). North star (epic #4359): in a new chat the user never has to
re-state known background.

## What was built (design notes are in the code comments)

- **「关于我」** at the top of /brain's personal space: 目标 / 偏好 / 约束与身份 / 在做的事. The grouping rule is one contract
  function (`kgProfileSection`). Each item can be rewritten (`revisePersonalClaim`: new `accepted` claim, old one
  `superseded` with reason `user_revised`, sources and goal links move to the new claim, /brain folds the old one as
  「取代了」), forgotten (the existing /brain forget path), and links back to its source message.
- **Goal → decision / todo**: structural relation `serves_goal`. After the #4283 auto copy, the extraction job asks the
  model which of the author's goals a new decision serves; it attaches only at confidence ≥ 0.8 (system identity, author
  derived from the evidence message, never over a previous link or unlink). The owner can relink / unlink in 关于我.
- **Profile summary in recall**: up to 4 profile items / 240 chars per turn, channel `claim` (recorded, cited), only in
  the requester's own personal threads. `recall.ts` is untouched; the change is additive in `recall-knowledge.ts`.
- **Opening briefing**: `GET /knowledge-graph/briefing`, composed on the server from the viewer's personal space only
  (long-term memory, todos from own personal threads, open conflict / possible-change cards in own personal threads).
  Bounded to 6 items, 80-char statements, 240-char prompts and a 2 s statement timeout. The client gives up after 8 s and
  never blocks the composer. 「续上」 prefills a first message that quotes the memory and shows the citation.
  Dismissal is stored on the server and can be reopened in 关于我. Telemetry: `kg_briefing_events`
  (shown / accepted / dismissed), readable only by the owner (RLS).
- **Golden set** skeleton: [`evidence/golden/`](../../golden/README.md). **North-star metric**:
  `apps/api/scripts/north-star-restate-rate.ts`.

## Stack (no Docker)

This round had its own Postgres 16 cluster `wsxs5` (AGE + pgvector, UTF8, port 55475), db `s5e2e`, redis on 29125, and
the API via `tsx` on 29122 with in-process extraction / projection workers. The web ran `next dev --turbo` on 29124 with
a 3 GB heap cap. Webpack dev was OOM-killed several times under the shared 14 GB cgroup, so turbopack was used for the
run. The model was the F15 loopback on 29120 (unmodified), behind `loopback-golden-model-provider.ts` on 29121, which
only answers the goal-link question. Chromium came from `/opt/pw-browsers`. Commands are in `harness/stack.sh.txt`.
Afterwards everything was stopped, the cluster was dropped, and the temporary spec, config and `.next-s5` were removed
from `apps/web`.

**Model: a stand-in, disclosed.** No real model was called. Extraction replies and the one goal-link reply come from
`evidence/golden/cases.json`. Everything downstream is the product path.

Rubric hash before and after: `3796053d1d1bd05dac14433e4beea45317befd46717bce7b284596de946733b1` (unchanged).

## Browser journey (`harness/journey.spec.ts.txt`)

Run 1 (`playwright-run1.txt`) passed steps 1–3. Step 4 then failed because the dev server was OOM-killed mid-run, and the
briefing fetch showed its "couldn't read" line. After a session restart, run 2 (`playwright-run2.txt`) re-ran steps 3–8
on the same database: **6 passed**. `journey.json` holds run 2's record and `journey-run1.json` holds run 1's.

| # | Step | Evidence |
|---|------|----------|
| 1 | With no memory, a new personal thread shows no briefing; the templates are as before. | `1-new-thread-without-briefing.png` |
| 2 | G001/G002: goal, decision and todo are recorded. The decision is auto-linked under the goal (`serves_goal`, created by the model, confidence 0.9). | `2-first-thread-recorded.png`, `db-proof.txt` |
| 3 | /brain 关于我: the goal has the decision nested under it, and edit / forget / source links are present. | `3-brain-about-me.png` |
| 4 | New thread: the 「接着上次」 briefing shows the decision (为了：goal), the goal and the open todo. The composer stays enabled. | `4-new-thread-with-briefing.png` |
| 5 | 续上 on the todo prefills 「继续这件待办：「下周约王老师聊课程设计」…」 and shows the citation line. The answer uses the memory, and citation chip [1] is the same claim as the briefing's `cite.claimId`. | `5a-…`, `5b-resume-answer-uses-memory.png` |
| 6 | G001: in a new thread, 「帮我规划」 gets an answer that uses the goal (recalled `kind=goal, scope=personal`). | `6-golden-g001-plan-uses-goal.png` |
| 7 | Dismissing persists across new threads. /brain shows 「已关闭 · 重新打开」, and reopening works. | `7a-…`, `7b-brain-briefing-off.png` |
| privacy | Another member of the same org gets no briefing, an empty 关于我, and none of the owner's text. | `8a-…`, `8b-…` |

`north-star.json`: 2 new sessions have known background, and 1 of them counted as a re-statement (see the open risk
below). The briefing was shown 5 times, accepted once and dismissed once.

## Tests and fail-without-fix

- API: `tests/knowledge-graph/s5-profile-briefing.test.ts` has 11 integration tests on a real DB and HTTP.
  `s5-profile-briefing-unit.test.ts` has 14 unit tests. The whole `tests/knowledge-graph` suite plus enum parity passes:
  824 tests. `recall-repo-guard.test.ts` was updated for the pinned `knowledgeMemoryFor(…)` call shape (it adds
  `personalThread` from `run.projectId`).
- Web: `tests/brain/about-me.test.tsx` (8) and `tests/knowledge/session-briefing.test.tsx` (7). `brain-screen.test.tsx`
  was adjusted because it scopes to the list and counts the extra briefing read. brain / knowledge / chat: 160 passed.
- `fail-without-fix-api.txt` / `fail-without-fix-web.txt`: every undone piece turns the relevant new tests red. These
  pieces are recall summary, the goal-link step, replaced-fold, the confidence gate, the own-thread limit on briefing
  todos, briefing composition, the migration, the empty-state slot, 关于我 on /brain, 续上 prefill, dismissal
  persistence, the empty briefing, goal-link projection and the rewrite call.

## Open risks

- The north-star metric counts a 续上 session as a re-statement, because the prefill quotes the memory verbatim and the
  user didn't type it. The metric should exclude first messages that equal an accepted briefing prompt; events carry no
  thread id yet.
- The empty state still has the chip 「记忆范围：仅本对话」 (pre-existing, #2130), which is now inaccurate in personal threads.
- Todos are not auto-copied into the personal space, so model goal-linking only covers auto-copied decisions. Todos can be
  linked by hand after promotion. Todos from own threads appear in the briefing but not in 关于我.
- The contract additions await human signoff (listed in `evidence/phase-18/r10/README.md` §3.2).
