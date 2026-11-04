# Chat failure controls #6244

The v2 message stream uses TaskTimeline → RunTracePanel. Terminal runs with failures (failed status or succeeded/cancelled with structured failed tool entries) now keep a compact summary; their plan and subtask detail remains available by expanding. Hide/restore stores only a browser preference keyed by organization, thread, run and latest attempt ID; no server journal mutation. Running runs and successful runs without failed tool entries ignore the preference.

Retry on the inline trace is offered only for the current error banner's run, with an existing resendable message, writable/nonbusy state, and no competing plan recovery. It reuses the same existing send/clientMessageId/attachments path as the error banner. Historical runs never dispatch retry against the current plan. Existing plan recovery remains unchanged.

Validation: unit.log (33 tests); browser.log (Chromium real component, compiled production styles, collapsed geometry <100px); compact-failed-trace.png visually inspected; typecheck.log (tsc --noEmit exit 0); design.log (lint-design passed). Browser screenshot uses SSR fixture and proves rendered geometry only; interactive hide/restore/retry and attempt/scope isolation are verified by component tests, not a live API browser journey. PR CI provides the application regression lane.
