# Recording history action alignment — #5774

StudioHistoryHeader has one production consumer, recording history. Its create action now reuses WorkflowActionButton; no duplicated sizing rules or global Button defaults change.

Baseline with the actual original lg header: height44px and cancel returned focus to BODY. The controlled CreateTranscriptionDialog has no Radix Trigger; its input autoFocus happened before the opening focus event. The fix explicitly captures the activating header/empty-state button from the click currentTarget, passes its ref to the controlled dialog, focuses the name input, and restores only a connected, enabled opener outside hidden/inert containers on cancellation. Programmatic opening without a trigger retains an active-element fallback. Successful creation skips restoration so navigation owns focus. Fields, submit logic and API/ASR behavior are unchanged.

Actual React header and original dialog rendered in a lightweight Vite browser fixture, not the authenticated recording route. 375/768/1280 screenshots/geometry show header and body primary height36px, same primary token, no overflow; 375 header fills its available row, desktop minimum112px. First field focus and cancel/Escape restoration were observed in all three widths. No API or ASR calls were made. Unit tests cover cancel, Escape, successful creation, plus existing history/shared-control regressions.

## Safari pointer review follow-up

Review found that activeElement alone is insufficient when pointer activation does not focus a button. The revised tests do not pre-focus the clicked trigger; an empty-state case starts with an unrelated header focused. Temporarily restoring the activeElement-only implementation made the regression fail; passing actual openerRef fixed all4 focus tests. Existing history/action tests passed (67 in the focused run) and web TypeScript passed after the mutable ref declaration was corrected. No API/ASR logic changed.

pointer-focus.json records actual header/body openers at all3 widths returning focus to their own controls. The lightweight fixture uses the production Header and Dialog with the same currentTarget-to-ref wiring as transcription-history, without a real recording/API operation.
