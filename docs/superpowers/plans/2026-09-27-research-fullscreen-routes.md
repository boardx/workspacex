# Research fullscreen routes

User request: reproduce the supplied seven screens, retain Workspace navigation on the list, enter a fullscreen research workspace with one shared timeline header, and give every screen a separate route. Generated content remains editable Markdown. Submit a verified PR; human merge only.

## Routes

| Screen | URL | Existing runtime node |
| --- | --- | --- |
| List | `/research` | None |
| New intake | `/research/new` | Session creation |
| Intake | `/research/:sessionId/import` | brief |
| Topic | `/research/:sessionId/topic` | directions |
| Plan | `/research/:sessionId/plan` | outline |
| Research | `/research/:sessionId/research` | research |
| Chapters | `/research/:sessionId/chapters` | report outline review |
| Report | `/research/:sessionId/report` | report |

The timeline excludes the list. It respects server availability. Opening an unavailable step clamps to a reachable server step. Authentication remains enforced by AppShell. Back to list restores navigation. URLs change with step changes, including server advancement; browser history restores the selected step without issuing a mutation.

## Work status

- Implemented: route pages, fullscreen shell switch, unified header, list return button, route synchronization, chapters review view, floating assistant, initial intake/report layout adjustments.
- Navigation/component tests: all 62 passed.
- TypeScript and scoped lint passed before the latest test-only correction.
- Fullstack first attempt failed in production prerender of `/research/new`; fixed with dynamic rendering. Second attempt passed the real browser/API/PostgreSQL research journey. Third attempt also passed with explicit chapters route refresh coverage (3m22s including isolated stack cleanup).
- Research-only landscape cards now use a decorative generated grayscale storage cover. Session content and source counts remain real. The shared Studio card is unchanged. New-creation assistant now floats rather than consuming a left column; affected tests, TypeScript and scoped lint passed.
- Browser at port 3000 reached authenticated login gate; no live visual acceptance yet.

## Remaining acceptance work

1. Finish production-backed browser verification of direct routes, refresh, back/forward and list chrome restoration.
2. Finish screenshot comparison for all seven supplied screens. In particular, list imagery, new intake content surface, topic fields, plan cards and report cover still need fidelity work.
3. Verify chapter edit/confirmation behavior against server commands. Current chapters view intentionally routes editing to the existing plan editor; report generation remains the existing runtime behavior.
4. Update PR #4299 only after required verification succeeds; do not enable auto-merge.

This document records unfinished work and does not declare visual QA passed.
