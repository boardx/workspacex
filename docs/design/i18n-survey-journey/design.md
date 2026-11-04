# Survey journey localization design — #6221

Spec authority: user-authorized B6 scope in issue6133 and issue6221. Native continuous execution in the original checkout is already authorized; no additional worktree/chat/agent or approval round. Recording PR6220 is tracked alongside B6; current delivery state comes from GitHub while historical proof remains frozen.

Localize fixed author and anonymous-user controls across actual /studio/survey/** and /surveys/[token], including nested dialogs/settings/previews/errors. Reuse existing provider and typed namespace registration. The actual live components, not legacy mocks, are the delivery surface.

The chosen implementation follows the existing render-time i18n architecture. Replacing authored survey/source/template/report data or translating canonical serialization would corrupt user content and published versions; introducing another locale store would break shared cross-tab preference. Both alternatives are excluded by the explicit preservation requirements.

Preserve user titles/tags/question/option/answer text, model output, template contents, raw reasons and file names. Preserve canonical Markdown headings, parser/serializer and exported report/response Markdown. Existing or copied editable content stays literal; new editable defaults may use the active locale once at creation. Locale changes never rewrite the current draft or retry a request.

Preserve all API/contracts/schema/permissions, anonymity, CAS/source revision, immutable publication batches, tokens, IDs, survey sample mathematics and financial units. Public submissionId/upload Promise/token/start time/lock remain stable. Collection clock and autosave identities do not include locale. Unknown diagnostics remain literal; known fixed messages resolve through semantic keys at render rather than storing translated strings in async state.

Use import-free fixed-copy definitions when runtime Error.message must share values with resources: preserve exact Error.message/class/retryable/reasonCode behavior, and do not make the global dictionary import an API client. Validation runs unchanged before display mapping; authored row labels and focus matching stay raw. Unsaved-navigation prompt updates must retain the current approval/expiry/listeners. The anonymous form reuses LanguageSwitcher because it has no AppShell/TopBar.

Acceptance is a real author→publish→anonymous answer/attachment/submit→author review/report/template journey, plus whole affected regression and meaningful pending/error/raw-continuity tests. Validate real API/PostgreSQL and wire/hash invariants. Capture actual375/1280 states with natural scrolling and individually inspect every image; preview/mock and external-model quality boundaries remain explicit.

Original raw stdout/trace/context/nativeJSON remain private0700/0600. Publish only allowlisted structured facts/hashes and author-viewed safe PNGs. Full source review, normal push/hooks, sourceCI/candidateCI and actualdevelop merge are distinct gates under the sole coordinator. One issue/one survey PR; the feature remains incomplete until real delivery.
