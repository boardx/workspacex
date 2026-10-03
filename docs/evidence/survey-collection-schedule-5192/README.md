# Survey collection start and end — #5192

The user confirmed immediate start by default, optional future opening and a deadline later than opening. Collection timing belongs to each immutable publication batch. Legacy publications without `startsAt` remain immediately available.

The command/publication contracts add optional `startsAt`. The service supplies immediate opening and a default deadline 30 days from the selected opening, validates the window, and freezes both dates in the publication and batch. The existing expiry argument remains compatible; the opening argument is additive.

One shared contracts module defines valid ordering, the default duration and inclusive opening/exclusive closing. Public reads/submissions and attachment capabilities use this same boundary. Pending public access returns the registered `SURVEY_NOT_STARTED` conflict; the browser explains that collection has not started. No database columns or migration are needed because existing publication persistence is a JSON document.

Initial publication and closed-batch republishing show both local date/time fields. Published dates remain visible after reload and historical batches remain unchanged. The owner clock updates every displayed batch at its next opening/closing boundary, including when a closed historical batch is selected.

## Verification

- New schedule behavior first failed: 10 failures, 1 legacy compatibility pass. An `openPublic` test-call typo was corrected; it is not counted as behavioral evidence.
- Three new UI schedule cases first failed due to the absent start field.
- Schedule service/contract suite: 12 passed. Broader API pure-memory suite: 5 files / 50 passed.
- Actual Nest HTTP: attachment suite 12 passed; publishing/anonymity suite 6 passed on a separate test database.
- Full survey frontend: 37 files / 356 passed before the final clock regression.
- Independent review found a historical-view clock bug. The new counterexample failed against the selected-batch timer, then passed after watching all collecting batches. Final publishing suite: 21 passed.
- Web, API and contracts typechecks, affected web ESLint, API lint and contracts lint: exit 0.

Complete final frontend/baseline verification, exact SHA review, live browser and CI results will be recorded separately. No final acceptance or merge is claimed yet. This branch depends on #5196; its PR diff contains only #5192.
