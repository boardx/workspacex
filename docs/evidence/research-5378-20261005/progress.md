# Progress

Known state-display bug reproduced and repaired. Partial failures remain visible while independently active tasks/attempts continue. Historical reading activity is scoped to report preparation and cannot turn a later search retry into active reading.

Initial 368 UI tests and CI passed but main independent review REJECTED an additional historical-reading counterexample. The correction uses optional current execution stamps instead of time guesses; old progress/activity is not relabeled. Corrected 422 API, 7 contracts and 372 UI tests, types and lint pass. New-head PR CI and main exact re-review are the remaining delivery gates; performance issue #5306 and non-RAG design #5365 remain separate and open.
