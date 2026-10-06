# Chapter-shared search delivery to main — #5496

GitHub main was0d4a041f3d807c42d93e839a4e09d94a48f63d9c. Earlier PR5465 was merged into codex/research-recovery-query-schema, not main. Its related merged status is not proof of main/deployed behavior. The user capture shows60 tasks for5 directions. This PR reapplies only chapter-shared initial task derivation against actual main; it excludes the parent recovery schema and malformed-candidate fixes.

One initial task is derived per enabled chapter, while all confirmed core/subsection questions and their evidence IDs remain unchanged. The existing confirmed question budget validation still runs. Source screening evaluates every question in that chapter and report quality still detects unanswered questions; a task success does not imply whole-chapter coverage. Existing manual/legacy per-question tasks and retry IDs are not rebuilt. Already running old sessions are not migrated or silently restarted.

Validation: original main with new regression assertions gives4FAIL/126PASS; fix passes26pure API files/570 tests. Independently reviewed exactfa631986b, focused130PASS. API type/lint exit0. Isolated owned PGlite with standard migrations/seeds, original business SQL and controlled providers passes49 persistence tests, including4unique answered question IDs/direct evidence and stable retry identities. Owner fixture mode and temporary bootstrap adapter do not establish native Postgres authentication/RLS compatibility. Owned PGlite stopped, fresh datadir removed, ports/reservation released.

Affected browser assertions retain planned core/subsection detail and require one chapter task; actual browser acceptance runs in CI. No production deployment, repaired existing user session or complete real-model report success is claimed.
