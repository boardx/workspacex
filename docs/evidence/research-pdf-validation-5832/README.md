# Research PDF validation — #5832

Actual devapp job `39eb95a6-f9c2-47be-8aac-dda1a4b45593` returned INVALID_FILE after native run `8725b2e7-c5c4-4f2d-a23a-3c6845badc64` succeeded. Existing PDF and its saved input were read through authenticated same-origin APIs, downloaded locally, and left unmodified. No model or regeneration was invoked. Browser temporary diagnostic download links were removed.

The input SHA256 exactly matches job source v3: `0dc10db9adac47ae905a7e300ad4b63c8d01497c42dbc57e9415a2eeb90346ee`. PDF 4301927 bytes SHA256 `c7dccf3ebe91501cf83b667900840dcf45c027d87c445c660f8c70378c516e79`.

Canonical comparison strips AST footnote references; extracted PDF previously retained `[^1]` and line-wrapped `[^ 7]`/`[^11]`, causing 23/54 canonical paragraphs to appear absent despite preserved prose and all source URLs. Each canonical paragraph now carries exact AST text/reference segments. Extracted text is retained unmodified; only at the original real-reference positions may a printed marker be present or absent. Literal code markers stay mandatory even when extraction loses backticks/fences; unknown IDs, missing/reordered prose and duplicates remain rejected. File bytes, canonical Markdown, authorization, version/hash, notices, full prose, URL, duplication and structure checks are unchanged.

- `red.txt`: new deterministic reproduction fails under old validator (28 existing PASS, 1 new FAIL).
- `green.txt`: full file suite 56 PASS, 1 conditional font SKIP; includes actual generated PDF bytes with footnotes and missing prose/URL/literal-code rejection.
- `actual-pdf-replay.txt`: original online PDF passes full PDFDocument + real anydoc + complete content validator locally after repair. No new model calls. Private report/body/binary are kept outside Git.
- API typecheck/lint and contracts typecheck exit 0.

This proves the existing actual PDF is valid under the corrected local validator. It does not change the stored online failed job, deploy code, or prove a new online job/download succeeds. Existing terminal failed jobs remain failed; any explicit retry must be evaluated against the deployed revision. No production data or configuration was modified.

## Review correction

The initial extraction-side marker removal falsely rejected literal code markers when PDF extraction did not recreate backticks. `plain-code-red.txt` confirms that defect on the previous implementation. The final positional paragraph matcher does not delete any extracted text. `green.txt` includes same-paragraph real reference + literal code, plain fenced-code extraction, wrapped markers, wrong IDs, reordered prose and duplicate paragraph rejection. Original actual PDF replay remains PASS. Source/formatting boundaries only; no online task state repair.

The matcher uses literal startsWith transitions with deduplicated offsets, not dynamic regex/backtracking. A 64-adjacent-reference fixture accepts preserved prose and rejects a changed ending without exponential matching.
