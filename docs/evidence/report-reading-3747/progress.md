# Report reading redesign — #3747

User approved a document-first reading layout and requested no 草稿 label in the generated report UI or filenames. This direct user task is outside the current readiness queue.

- Report-only reading layout, collapsible assistant preserving input, compact workflow disclosure and return control.
- Desktop sticky contents; mobile contents disclosure. Continuous chapters and larger body type, with no nested section cards.
- Generation and export actions grouped. UI controls excluded from PDF/Word; full contents, chapters, references and tables retained.
- Internal provisional/reportDraft state and all source/quality gates unchanged. Failure does not become completion.
- Browser screenshots use synthetic runtime responses in a temporary preview route, not live model evidence. 1440px desktop and 390px mobile; no horizontal mobile overflow.
- init.sh fast baseline passed. Frontend report/research regression: 157 tests across 23 files; lint/design and typecheck passed.
- Coordination tick unavailable because COORD_GATEWAY_URL is not configured; no ownership or lease claimed.

Independent read-only review ACCEPT after updating E2E interaction selectors. Full service-backed E2E is delegated to CI; local browser evidence uses synthetic runtime only.
