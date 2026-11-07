# Honest tool approval summaries (#6320)

The original CN request contained a 2000-character command ending in
`…[TRUNCATED]`, while the card claimed “完整，未截断”. The backend's
`publicExecutionPayload` deliberately retains its existing per-string
redaction and bound through `redactErrorMessage`; this is a summary, not a
complete executable parameter view.

The card now labels its content a tool argument summary. It explicitly marks
the existing truncation marker and tells the user how to obtain a reviewable
request: deny this operation, ask in chat for short commands that can be fully
reviewed, then review the replacement request. Unknown completeness is never
presented as complete. The actual summary remains unchanged, as do all
decision enums, persistence, redaction and authorization boundaries. There is
no new full-parameter endpoint and no increased logging/summary limit.

Source regression on base `33f3bd0313dcfef86a9240e93dbb203bdee3a76b` plus patch:

- Two new behavior assertions failed before the change (14 existing passed).
- `WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web exec vitest run tests/agent-kernel/tool-permission-card.test.tsx tests/ui/i18n-chat-permission-display.test.tsx`:
  19 tests passed. Covers exact summary bytes, truncation guidance, denial,
  existing four decision options, controlled state and English/Chinese changes.
- Full Web lint passed; typecheck is recorded in PR validation.

This is the honest-summary alternative, not a claim to expose complete
parameters. No CN deployment or post-release approval/recovery acceptance has
been performed. Original rejected commands and subsequent successful PDF
recovery remain separate historical outcomes.
