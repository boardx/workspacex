# Second real browser run: driver failure, not acceptance

Source `b8b7ed4655a44bd7c70bc3409c87dba6ec8fe3f2` (product and test driver byte-identical to `080bbba0ee858525f57fedefe42fa68ea938d91b`). Wrapper exit1/432.046s; first case hit its original180000ms, two cases did not run under max-failures1. Zero passes; no retry. The browser-context-close error is secondary teardown after the timeout, not the initiating wait.

Private native trace's last active test action is `fillMeeting` waiting for the first required scale fieldset using exact name `会议目标和议程清晰。`. The actual visible question has radios; `question-renderer.tsx` fieldset legend renders the authored title followed by ` *`. The title-only exact locator therefore cannot match. The same correction is needed for four required scale groups and the required duration choice group. Preserve the exact raw title and marker, original fourth-of-five choice, and all subsequent assertions.

Observed before the blocking wait: real draft publication POST returned201; the survey displayed collecting with zero responses; anonymous public form loaded, displayed current-English required validation, and accepted the first raw text answer and date. No attachment upload, submission, governance, report, download or PostgreSQL comparison was reached. No mutation receipt was produced. Do not combine this partial result with the first run to claim acceptance.

A separate static driver audit found an unreached success assertion expecting `Thank you`, although `public-survey-form.tsx` displays the published `successMessageMarkdown` authored data. The schema's existing default is Chinese and the real publication screenshot preserves that text. Correct the test to compare the actual frozen publication settings' raw value across locales; do not translate or modify the canonical default.

All15 actual PNGs (12 planned at375/1280 and3 native failure screenshots) were individually opened and viewed. No new material visual defect was observed in these captured viewports. Reported count phrasing and share-help spacing from the first run are visibly corrected. This does not establish QA for uncaptured upload/report/template/intake states. Native screenshots/trace remain private, including a share capability in test-failed-1. Public manifest exposes only names, dimensions, hashes and QA notes.

Own isolation `wsx-7750e311e313d42a0ba8` was verified to have zero containers, zero volumes and zero listeners on its11 reserved ports immediately after actual exit. Both peers received the resource release before archive/diagnosis/QA.
