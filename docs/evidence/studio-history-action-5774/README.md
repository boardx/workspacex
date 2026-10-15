# Recording history action alignment — #5774

StudioHistoryHeader has one production consumer, recording history. Its create action now reuses WorkflowActionButton; no duplicated sizing rules or global Button defaults change.

Baseline with the actual original lg header: height44px and cancel returned focus to BODY. The controlled CreateTranscriptionDialog has no Radix Trigger; its input autoFocus happened before the opening focus event. The fix explicitly captures the opener in onOpenAutoFocus, focuses the name input, and restores only a connected, enabled, visible/inert-free opener on cancellation. Successful creation skips restoration so navigation owns focus. Fields, submit logic and API/ASR behavior are unchanged.

Actual React header and original dialog rendered in a lightweight Vite browser fixture, not the authenticated recording route. 375/768/1280 screenshots/geometry show header and body primary height36px, same primary token, no overflow; 375 header fills its available row, desktop minimum112px. First field focus and cancel/Escape restoration were observed in all three widths. No API or ASR calls were made. Unit tests cover cancel, Escape, successful creation, plus existing history/shared-control regressions.
