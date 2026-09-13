# Report reading and export cleanup — #3578

Direct user bug fix outside the readiness queue: internal review diagnostics were being rendered inside the report article and exported as report content.

- Separate saved report reading from generation timeline and generic warning panels.
- Keep draft state outside the article and in exported filenames; do not change backend completion gates.
- Export the full title, table of contents, sections, conclusion and references without workflow notices.
- Preserve genuine limitations written in report content and source citations.

Regression evidence: initial UI tests failed (4 failures); initial export tests failed (5 failures). The affected research suite subsequently passed 165 tests across 25 files. Export tests unpack generated DOCX XML and inspect the isolated PDF print document. No production session or external model was accessed for this fix.
