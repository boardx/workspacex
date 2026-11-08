# #6442 browser presentation verification — 2026-11-09

Native Chrome, local http://localhost:3153/preview/content-cards-6442, real product components with explicitly synthetic fetch/session fixtures. Working source supplied by sole writer in /Users/shenyangjun/.codex/worktrees/f0e0/workspacex on worker/content-card-alignment. Uncommitted working-tree state, not an exact-SHA release acceptance. Every after PNG was emitted and visually inspected. Full-window images stay in /tmp because unrelated browser tabs are visible; do not publish these images unredacted.

| Check | Result | Evidence |
|---|---|---|
| Project All seven populated types, three-column grid, two-line long titles | PASS | after-01-project-all-light |
| Survey filtered same grid width/left boundary, draft and date | PASS after fixture session repair | after-09-project-survey-session-fixed-light |
| Chat populated; no associate action, sharing selector retained | PASS | after-12-project-chat-light |
| Board/interview/research/transcription/design filtered cards | PASS | after-13 through after-17 |
| Single survey New menu contains only survey; Escape returns trigger | PASS | AX observations during run |
| Association opens actual candidate and collapse action | PASS after real StrictMode fix | after-18-project-picker-fixed-light |
| Collapse → board → survey stays closed; active associate can reopen | PASS | sequential fresh AX observations |
| Observer switch while picker open hides picker/new/associate/card-more | PASS presentation only | after-19-project-observer-light |
| Independent interview/rec/research empty lists, one create entry | PASS | after-03,04,05 |
| Interview/rec create dialogs open; cancelling returns trigger | PASS, no submit | fresh AX observations |
| Research create navigation | href verified only | /research/new observed; not navigated |
| Survey populated card and optional report block outside grid | PASS | after-06-library-survey-light |
| Independent Board populated long-title card | PASS layout | after-07 and latest after-24 |
| Board heading enlarged and eyebrow removed | PASS | after-24-library-board-heading-light |
| Independent design 8-card grid | PASS | after-08-library-design-light |
| Dark desktop and light/dark 375×812 survey | PASS visual | after-20,21,22; device dimensions confirmed in AX |
| 375 survey card-more does not navigate; Escape returns card trigger | PASS | fresh menu AX; URL remains preview |
| Design 8-card mobile list scroll reaches last card and following sample section | PASS | after-23-design-375-scroll-light |
| Board no-match search | NOT VERIFIED | fixture returns same card regardless of query; input cleared afterward |
| Real API authorization, persistence, model calls, production release | NOT RUN | presentation fixture cannot establish these |

Failed-run ledger: after-02 captures missing synthetic session, showing Please log in; not PASS. Session fixture fixed without product auth relaxation; successful replacement is after-09. after-10 and after-11 capture association still closed; not PASS. Browser exposed actual StrictMode effect replay defect; writer fixed effect/reset handling and successful replacement is after-18. Initial route load was delayed by first compilation; no loading screenshot counted as acceptance. after-07 predates final Board heading adjustment; after-24 is final spotcheck. Board preview image fixture shows unavailable preview; no thumbnail rendering acceptance.

Claims are deliberately bounded: same-kind row/grid title/date alignment observed; shared edge-case sample cards have different descriptions/actions, so their metadata does not all lie on one horizontal line. Chat preserves date grouping and a sharing selector, making its height differ. No numeric DOM overflow measurement or complete accessibility compliance audit. All seven project filters inspected at desktop; narrow coverage targets survey and design, not every library in every theme.

No production data created/linked/deleted; no model/mic calls. DevTools device preference restored from 375×812 to original455×784, device mode off and DevTools closed. Local preview remains light; production theme was previously restored dark. Writer notified presentation pass and permitted to clean temporary preview/service. Final exact-SHA tests/PR ownership remain with writer/coordinator.
