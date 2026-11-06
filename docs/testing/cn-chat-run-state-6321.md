# Durable run announcements (#6321)

CN's accessible status region announced completion while the actual task was
waiting for approval or continuing after approval. The old producer treated
SDK `agent.isRunning` falling to false as a business terminal. The SDK can
normally stop its transport for tool approval; durable execution remains active.

The producer now uses the same existing run/approval/restore busy projection as
the Chat workbench, with explicit waiting and paused messages. A new terminal
proof for the current live run is required for a finished/stopped message. Only
the SDK's actual custom stream establishes live identity; historical journal
hydration and sticky Inspector IDs never do. Active authoritative restoration
can supply waiting/paused state over a stale completed live stream. Scope is
organization/user/thread; changing it clears the previous announcement.

The new hook keeps this state logic outside the main Chat body. It does not
change run execution, tool approval permissions or the historical timeline.
No completion is invented merely because a stream disconnects; unknown state
clears stale text while waiting for durable evidence.

Local verification on base `33f3bd0313dcfef86a9240e93dbb203bdee3a76b` plus patch:

- `WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web exec vitest run tests/ui/chat-run-announcements.test.tsx tests/ui/run-trace-live-identity.test.tsx tests/ui/copilotkit-v2-run-restore-on-remount.test.tsx tests/lib/copilotkit-v2-run-restore-bounded.test.tsx tests/ui/i18n-chat-composer-continuity.test.tsx`:
  5 files / 28 tests passed. Covers approval/resume with idle SDK, unknown stream
  endings, historical-terminal negative, pause/cancel/failure, thread changes,
  language changes and existing restore/composer continuity.
- Independent review found delayed hydration could change an old terminal's
  proof without a new run, and an old Inspector run ID could mask later ordinary
  Chat runs. Two added counterexamples first failed, then passed after explicit
  active-run binding replaced the sticky ID priority. A further review exposed
  null-identity activity receiving old history; final selection therefore uses
  only explicit live-stream identity or active authoritative restoration, with
  actual hook tests proving hydration cannot establish/replace live identity.
- Full Web lint and final typecheck passed. Initial typecheck caught a wrong
  pending-approval variable name, corrected before final verification.

The UI hook tests use deterministic status inputs; restore tests use their
existing API/event fixtures. They are not CN real-model acceptance. No release
has been performed. Post-release CN testing must observe actual approval,
resume, final writeback and refresh without a false completion announcement.
Queue dispatch and refresh restoration with no live stream retain their terminal
state in the timeline; this announcer clears on idle rather than inventing a
completion from history. The old announcer also covered only SDK live activity.
