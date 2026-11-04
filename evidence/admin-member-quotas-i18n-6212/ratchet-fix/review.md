# Bounded ratchet repair review

CLEAN — no actionable P1/P2 findings.

Reviewed exact `063809984cc2b45e58cb1f23ccbf835133debff3..44f41de5e5ca5615c52354b370380f7ebc50d404` against ratchet-fix-brief.md and ratchet-fix-review.diff. Independent byte comparison confirms precisely five approved LEGACY values decrease 1→0 and org-admin-screen decreases 5→4, retaining all entries. Every other scanner byte, including other counts, ROOTS, EXEMPT, RULES, traversal, drift and exit logic, is unchanged. Git confirms only scanner and its test change; no product/API/E2E/config edits.

Both original tests are byte-identical. Two added parameterized cases each create an isolated temporary repository, copy the unchanged scanner and both complete scanned roots, and require a passing copied baseline before injecting raw return String(err). The unlisted-path case then requires status 1, its target path and the real new-violation diagnostic; the cleared legacy-path case requires status 1, its target path and the exact 1-versus-0 regression diagnostic. Both reject unrelated decreased-baseline diagnostics and clean their scratch directory in finally. No ignore, skip, assertion weakening, increased allowance, retry or timeout change observed.

Read ratchet-fix-red.json: root actual scanner RED at reviewed base records exactly these six decreased counts (exit 1; 0.394s). Root owns scanner/four-case GREEN, which was pending at review. Reviewer ran no scanner/tests, heavy gates, services or browser checks. Whole-feature and 17-image acceptance are outside this review.
