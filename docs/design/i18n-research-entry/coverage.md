# Research journey coverage — #6198

Status is pending until the actual command/browser evidence exists. Route aliases retain canonical identifiers. No row is complete merely because its resource key exists.

| Actual entry / child surface | Required overlays and states | Current evidence |
|---|---|---|
| /research | list count/date/status/action, loading/error/retry, empty/filter-empty, query/tag/status/sort; raw titles/tags | entry RED executed; implemented, GREEN pending |
| List card management | more menu, rename/tag draft, IME/new/duplicate/limit notices, pending/failure save; delete confirm/cancel/pending/failure | entry RED executed; implemented, GREEN pending |
| /research/new | goal/optional fields, constraints, upload TXT/MD/CSV + invalid/empty/UTF8/size, pending/create failure; original payload/idempotency | entry RED executed; implemented, GREEN pending |
| Intake voice | connect/listen/pause/reconnect/stop/cancel/error, recover confirmed text; original transcript and stream identity | entry RED executed; implemented, GREEN pending |
| Intake assistant and shared shell | open/close/focus/Escape, message/pending/failure/proposal/apply; steps/back/discard/keep editing; raw message/proposal | shell RED executed; shell implemented, assistant chrome pending |
| /research/:id/import | persisted topic/raw fields, system focus labels with canonical saved values, autosave/pending/failure/retry, read-only; route load/recovery/authorization | workspace focus test written; RED pending |
| /research/:id/topic and /plan | actual canonical plan mapping, edit/add/remove/reorder, draft save and confirmation, pending/error, read-only, next generation | workspace plan test written; RED pending |
| /research/:id/research | actual report mapping; collection/source loading, accepted/excluded/raw titles, empty/retry/pause/resume, evidence limitations | pending |
| /research/:id/chapters | actual report mapping with chapter workspace, selected chapter/editor, save/discard, raw body/questions; per-step status/timeline | pending |
| /research/:id/report | report reader/metrics/contents, history, source/reference links; raw report/title/body/references; regeneration and assistant/markdown overlays | workspace report/history test written; RED pending |
| Report file actions | PDF/Word creation/status/permission link/download, failed/live read notices, retry without duplicate work, epoch/version guard | workspace pending-file identity test written; RED pending |
| All desktop/mobile routes | language swap without reread/POST replay/remount/draft loss, keyboard/aria/focus, English wrapping, original Chinese default | actual seeded browser pending |

Non-acceptance: historical research prototype fixtures and unused legacy screens are not counted as actual journey evidence. Canonical Markdown protocol headings and generated/user documents stay raw, even when Chinese remains visible. Report summary/introduction/conclusion/reference and chapter headings remain canonical; the contents control name/aria and expansion actions follow the UI locale. Actual current route behavior determines inclusion, not stale comments.

Next B5 journeys after research: /itv home/history/experts/search/sort/new/empty, /itv/experts/:expertId, /itv/new, /itv/:id/setup and all stage children, /itv/quick/:id, /itv/live; /rec history/new/record/stop/transcript review/edit/save and overlays. Next stage B6 covers full survey template/type/design/publish/anonymous response/results/report journey. All remain pending and are assigned through main's matrix, not inferred completed.
