# IME confirmation remains separate from tag submission

Base: 71397638cb4362652d8c43e623bb6d11edbcf652. Its change from the previously reviewed head is confined to the Bailian test; TagInput is unchanged.

The composition guard prevents Enter, commas and Backspace from editing chips while an IME session is active. A subsequent ordinary Enter still submits the completed text. Six regression cases cover composition lifecycle, native composition state and the legacy 229 key code.

The original independent review accepted this same code/test patch. On the updated base, the two selected component test files passed. The numeric result is recorded alongside this note. This verifies component events in jsdom, not an operating-system IME end-to-end session. Raw diagnostic logs remain local in /tmp and are excluded from the commit.
