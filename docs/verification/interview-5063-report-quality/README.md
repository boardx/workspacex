# Report generation quality rejection (#5063)

Genuine DashScope diagnostic returned 4718 characters without failure flags; raw Markdown regex incorrectly missed bold boundary labels and standalone validation sections. Check visible Markdown prose and concrete actions under recognized action headings. Exclude HTML, code examples, inline code and image text from quality evidence. Persisted research Markdown is not rewritten.

Red regressions precede the change; contracts tests pass 15/15, pure API report tests 8/8 (temporary config without database lifecycle because this file contains only pure assertions). The initial bare API invocation was blocked by isolation guard and is not counted. Real browser report generation succeeds and saves version 1 with source references, simulation disclaimer and complete analysis. Screenshot and actual synthetic generated report attached; probe response is genuine provider output, never inserted as a browser fixture.

Word download event could not be captured in the in-app browser; clipboard share reports a permission fallback. PDF uses native print, outside authorized native-picker scope. These do not establish successful exported/downloaded artifacts; follow-up acceptance remains required. Whole-web observation has unrelated failures; CI remains required.

Independent review follow-up: empty analytic headings plus “测试用户” incorrectly passed. Added regressions (red:2 fail/15 pass), excluded headings without prose, and required concrete validation cues in action-section fallback. Final18/18 pass, including empty sections with an otherwise concrete action. The actual saved genuine report md-b69c007f-e0bf-498b-a440-2953409aa13e still passes unchanged (see real-report recheck).
