# Citation prompt guidance (#5299)

Provide concrete full raw quote/locator examples from the server evidence index and explain invalid citation shapes. Repair guidance requests the full report, counterevidence and valid source attribution. Validators and raw model bytes remain unchanged.

37 grounding/recovery tests passed against the updated main base. Independent review found entity escaping missing: named/decimal/hexadecimal HTML entities must remain literal quote text. Three regressions failed before the fix; 40 grounding/recovery tests passed after escaping entity starters in both example locations. Normal pre-push typecheck/lint required.

Earlier public synthetic real-model trials improved citation shape but did not pass all report validation. They are not evidence of a completed valid report. Integrated real-model validation with the separately delivered consensus fix remains pending. Original private devapp rejection cause is unknown.
