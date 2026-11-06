# Durable run announcements (#6321)

CN's accessible status region announced completion while the actual task was
waiting for approval or continuing after approval. The old producer treated
SDK `agent.isRunning` falling to false as a business terminal. The SDK can
normally stop its transport for tool approval; durable execution remains active.

The producer now uses the same existing run/approval/restore busy projection as
the Chat workbench, with explicit waiting and paused messages. A new terminal
proof for the current run is required for a finished/stopped message. An old
terminal captured before new activity cannot settle that activity. A restore
status from another run is not relabelled as the current run's status. Scope is
organization/user/thread; changing it clears the previous announcement.

The new hook keeps this state logic outside the main Chat body. It does not
change run execution, tool approval permissions or the historical timeline.
No completion is invented merely because a stream disconnects; unknown state
clears stale text while waiting for durable evidence.

Local verification on base `33f3bd0313dcfef86a9240e93dbb203bdee3a76b` plus patch:

- `WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web exec vitest run tests/ui/chat-run-announcements.test.tsx tests/ui/copilotkit-v2-run-restore-on-remount.test.tsx tests/lib/copilotkit-v2-run-restore-bounded.test.tsx tests/ui/i18n-chat-composer-continuity.test.tsx`:
  4 files / 23 tests passed. Covers approval/resume with idle SDK, unknown stream
  endings, historical-terminal negative, pause/cancel/failure, thread changes,
  language changes and existing restore/composer continuity.
- Full Web lint and final typecheck passed. Initial typecheck caught a wrong
  pending-approval variable name, corrected before final verification.

The UI hook tests use deterministic status inputs; restore tests use their
existing API/event fixtures. They are not CN real-model acceptance. No release
has been performed. Post-release CN testing must observe actual approval,
resume, final writeback and refresh without a false completion announcement.
