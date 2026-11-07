# Public design share i18n — #6260

The anonymous `/d/[token]` page must render its owned chrome in the current English or Chinese locale while showing the published design snapshot verbatim. This is a frozen design share, not a conversation share or the design editor.

Scope: loading, missing/revoked and temporary failures, explicit retry, author/publication/read-only metadata, snapshot explanation, problem-section heading, empty pages, fallback page names, ungenerated-page hint, back navigation, and reachable canvas chrome/ARIA (HTML preview title, footer navigation, board/chart summaries, unit prefix and native select fallback). Add the established anonymous LanguageSwitcher without changing page identity. Raw names, owner, problem, criteria, notes, frame labels, prototype text/HTML/links/data/units remain untouched.

Preserve `[token, load, reloadAt]`, cancellation, explicit retry, all frame/back-stack transitions, viewport scaling and design theme. Locale changes do not load, write, retry, navigate or reset the page. Error classification is independent of translated labels. The public page never passes regeneration/edit callbacks or `drawing`; those branches remain outside this issue and are not enabled.

`PrototypeCanvas` receives an optional display-only `chromeLocale`, default Chinese for existing callers. Use a separate private context, never the context spread into HTML srcdoc; changing locale must preserve iframe srcdoc bytes and element identity. `humanTime` may accept an optional third locale after the existing injected `now`; date arithmetic, thresholds, timezone and invalid/future-date behavior stay identical.

Acceptance: real-provider render tests cover English/Chinese on the same DOM, no locale refetch, navigation persistence, raw values, error/retry boundaries, default Chinese compatibility and canvas srcdoc bytes. Existing Chinese share tests remain intact. A canonical seeded runtime must cover a real published snapshot, anonymous phone/desktop locale changes, navigation and revoke, with every actual PNG reviewed. Existing `e2e/design-share.spec.ts` uses route fulfillment and is regression evidence only, not a real publish/revoke acceptance claim.

This page closes the concrete remaining B3 page proposal. Overall remains 1/10 (10%) until main reviews the complete B3 closure matrix and accepts that stage. Other project flows remain separate issues.
