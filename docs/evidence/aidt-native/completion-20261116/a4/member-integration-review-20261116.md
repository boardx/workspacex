# A4 — Member text integration regression

2026-11-16 UTC; repository product baseline `c361ba55b`. This was a read-only product review plus existing controlled regression tests. No product files, permissions, balances, projects, messages or queues were changed; no browser, service or model was started.

## Findings

No new reproducible member-text defect was found. The member controller/launcher/adapter's last product change is `c351f3f10` (pending-topic composer protection), before the existing native N08/N09 acceptance. The native host context bridge did not alter those member modules.

- The single global launcher remains under `SessionProvider` in `app/providers.tsx`, outside the nested AIDT Copilot host. Default opt-in and unauthenticated states perform no member initialization/read. AIDT pages, original project routes and explicit Studio project context resolve the real project; ambiguous/malformed location context is rejected.
- Project and organization/user scopes retain separate drafts and cached topics; a route change does not silently switch an already selected discussion. Changing the selected group rechecks access before showing cached history. Actor changes discard the previous UI; token changes abort writes and revalidate.
- Human messages use only approved `member-chat` endpoints, with credit notices disabled for these requests. No Agent ID, native model turn or invented read/online status is introduced. A member message does not automatically become a saved stage, report, or AI context; optional stage references are metadata on an explicit message.
- Server save status requires a genuine author-matched receipt. Lost receipts and temporary errors retain the original pending text/request ID; retries do not consume a newer draft. Idempotency conflicts do not create another ID. Frontend read-only/denial races remain guarded; backend authorization is independently authoritative.
- Replies remain one level, bound to the real root/project. The committed pending-topic state blocks the previous channel composer until the new topic is ready. Topic and channel drafts are distinct.
- Foreground, online, open panels poll approximately every five seconds. Closing/hiding pauses reads, then reopening catches up from server watermarks. Directory labels never grant access or claim online membership.

## Validation

`/tmp/aidt-a4-member-integration-regression.log`: **6 existing files / 60 tests passed; exit 0**, one worker, Node22/pnpm9:

- `project-member-chat.test.tsx` — 29
- `team-text-conversation.test.tsx` — 6
- `project-member-chat-launcher.test.tsx` — 6
- `project-member-topic-transition.test.tsx` — 1
- `live-project-member-chat.test.ts` — 10
- `project-member-chat-navigation.test.ts` — 8

These are controlled component/adapter regressions, not a new browser or real multiuser run. No mirror tests were added.

Prior real evidence was checked rather than relabeled as new: `/workspace/scratch/aidt-completion-acceptance/attempt-full-08/results/persistent-roundtrip.json` still exists and reports `completed=true`, `nativeStartStopCycles=2`. Its native dual-account/persistence scope and the related N09 evidence remain as documented by root/A6. The 22-surface actual UI evidence is `a6/global-member-text-surfaces.json`; that run explicitly recorded no generation requests, unique saved root/reply IDs and same-page-session draft restoration.

## Remaining boundaries

Unsent drafts are in authenticated page-session memory: close/reopen and application route changes are supported; page reload, logout and browser restart recovery of **unsent** drafts is not implemented. Persisted messages have separate real restart readback evidence. Unread cursors, read receipts, notifications, online counts, voice/P2P and 30-person load/real classroom validation remain outside this regression. No new paid acceptance or ordinary-student model permission is claimed.

A separate read-only review of A6's in-progress same-group QA noted that a generic “previous-stage head” expectation must not overwrite S6's frozen historical S5 source when reusing an older round. A6 was notified directly; this review did not edit its QA or the product to follow a newer head.
