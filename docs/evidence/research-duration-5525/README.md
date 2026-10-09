# Research pipeline work reduction — issue 5525

## Confirmed code defects and changes

- Search previously downloaded and screened every provider candidate before publishing any accepted source. With a document reader, candidates now use provider-ranked three-source windows. Approved windows persist immediately; processing stops when the current task has three approved documents. Chapter execution remains serial. All accepted material still passes relevance screening and report extraction verifies quotes independently.
- A rich confirmed plan can contain one or two subsections, but chapterStructureIssues required three headings and paragraphs. The structural floor now follows confirmed subsection count; legacy plans retain three. Required titles/order/substantive paragraphs and independent fact/depth review remain enforced.
- Internal warning labels no longer ask the user to verify sources. Warning/failure state remains distinguishable from formal completion; the quality error no longer instructs users to supply sources.

## Verification

- Red reproductions: ten reads instead of expected three; accepted source unavailable while subsequent candidates processed; one/two-section plans rejected despite matching confirmed headings.
- API research unit suite: 30 files, 682 tests (final result recorded in PR).
- Web affected UI suite: 4 files, 40 tests pass.
- API and Web typecheck; API lint pass.
- init.sh --quick passes (dependency/bootstrap check, not full repository verification).
- Independent read-only review accepted; additional tests cover retention after later failure and cancellation with no late publication.

## Limits

This is controlled orchestration and UI verification, not a timed rerun of the private devapp session. Three-source windows can require extra screening calls when earlier candidates are irrelevant; no universal speed/call-count guarantee is made. Existing six-query supplements and per-call timeouts remain. No evidence check is disabled and no draft is promoted merely to conceal a quality failure. The exact cause of the supplied 24-minute server execution has not been established from private diagnostics.
