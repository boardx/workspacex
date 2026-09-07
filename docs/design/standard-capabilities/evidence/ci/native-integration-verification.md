# Native runtime integration verification

The exact peer b952314f0 is integrated without merging main. The existing event journal, authority and artifact writeback remain authoritative.

- Cross-stack lane: official Python factory, real isolated sandbox, HTTP authority, PostgreSQL, FsObjectStore, and existing writeback passed. One artifact version and one attachment were created. The model/grader were scripted; this is not real-model or full production-DI acceptance.
- Broad runtime regression: 804 passed, 42 failed (130 files). Raw failure output is retained.
- Repaired 24-file run: 142 passed, one path-normalization assertion failed. Corrected guard plus invocation/size guard: 16 passed. These are separate invocations, not a claimed all-green full-suite rerun.
- Scope decisions include real PostgreSQL once/run/forever/deny, concurrent CAS winner and rollback counterexamples. No new permission allowlist entry was added; tenant table discovery reports 201.
- Required Skill facts never silently downgrade to polling. Old HTTP fixtures now supply a valid completed SSE stream. The normal configured SSE provider supplies a stable assistant identity; the journal relay retains tool steps, planning notes and HITL bracket closure without fabricating tool results.
- Native mode is explicit opt-in (`KERNEL_NATIVE_RUNTIME=1`), with dedicated encrypted session bindings and deployment-owned UDS/service credentials. Legacy text-only subtask mode is not upgraded implicitly. The official delete tool is included in the trusted approval profile; its default L2 classification remains unchanged.

Remaining: fresh aggregate PR CI, actual deployment configuration, real model and full workbench acceptance, and the grey backlog in development-flow.md.
