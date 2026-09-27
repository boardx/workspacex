# Markdown planning route integration

Refs #4431; depends on source API PR #4430.

The explicit intake and analysis routes now use the versioned Markdown source API. Intake editing, saving, confirmation and generated analysis consume the raw document, not a second JSON research body. Generated analysis is parsed into read-only cards; no fixed findings are substituted. Failure recovery refreshes a persisted partial document's version without replacing editable intake text.

Verification: 36 tests across interview-setup-workflow, interview-markdown-intake and interview-markdown-api passed. The named analysis route test first failed because the old route did not show the source document, then passed after integration. The partial-generation recovery test first failed because the source was not reloaded, then passed after recovery was added. Changed-file ESLint passed.

Boundaries: this is not the whole redesign. Legacy setup remains compatible until downstream Markdown consumers are migrated. File extraction and voice callbacks are not yet wired to live services; their controls remain unavailable rather than claiming unsupported capability. Expert/question/run/report cutover, revision recovery and real browser/model verification remain pending. Mocked HTTP tests do not establish real-provider success. No merge or deployment was performed.
