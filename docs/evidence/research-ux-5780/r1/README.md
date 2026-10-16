# Research UX R1 — input boundary (#5782, tracker #5780 / parent #5777)

Baseline: accepted research UI e8dcb10241afa7eaf3e234b4186c2edf29527684; at capture time main was4cc236c75 and baseline PR5772 was not merged. This round is an incremental input-validation fix, not a repetition of the prior responsive action renderer.

Actual Next /research/new walk: optional time range accepted201 characters with maxLength=-1, no alert and enabled continue (before.json/jpg). GuidedResearchBrief has a200-character limit. No API creation/model command was submitted.

The UI now consumes the existing contract shape for optional lengths and validates the normalized brief before confirmation. It never truncates existing input: an overlong value remains intact, is marked aria-invalid/describedby and blocks continue with a named error outside collapsed details. New normal keyboard input cannot exceed the contract limit; correcting the field removes the error and restores continue. API/schema and all fields remain unchanged.

Actual fresh-page after.json/jpg:201-character value injected through accessibility setter represents overlong restored input, preserved with a named error and disabled continue. bounded-input.json verifies ordinary typing at200 does not add a201st character. corrected.jpg shows recovery. No browser runtime-state mutation or network interception was used.

Regression: new restored-input case failed before implementation (21 existing passed), then51 creation/history tests passed. Web TypeScript and focused lint passed. Authenticated list and runtime plan/report paths are not claimed in this round; R2–R4 remain separate rounds.

Main delivery: only the validation delta was applied to f550634adcbaaea209fd4ef75fb1ed819864381a, without PR5772 layout changes. This combination passed50 creation/history UI tests and web TypeScript; the earlier screenshots document the independently accepted UX checkpoint.
