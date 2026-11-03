# Project reference correction: red / green retrieval check

Applied `superpowers:writing-skills` to the factual module reference update. This is a reference correction, not a new behavioral workflow or discipline rule.

| Phase | Independent scenario | Observed answer |
|---|---|---|
| Red / old guide | Fresh-context `project_skill_baseline`, read only the unmodified fd6debca module guide; choose kind set, creator permission acceptance and list shape under limited time | Three subtype containers; creator overview 403 is expected; member/managed response. All three contradict the current contract/PG implementation. The reader explicitly preferred the stale current-invariants section over the ambiguous later historical note. |
| Green / revised guide | Fresh-context `project_skill_updated`, same questions, read only the revised guide | workshop/general; creator gets facilitator+host or owner and overview 403 fails; flat list. All three match current sources. Reader explicitly treats old 2026-08-12 notes as history superseded by later decisions. |

Oracle: `packages/contracts/src/project.ts` (`ProjectKind`, `listProjects.out`), `apps/api/src/infrastructure/project/pg-project-repository.ts#create` (actual membership INSERTs), and existing real project-create/session regressions. No production authorization changed.

- [x] Reference retrieval/application scenario written; old guide restored for the no-correction control.
- [x] Independent baseline observed before restoring the minimal correction; exact wrong interpretations above recorded.
- [x] Minimal factual correction and explicit precedence for historical notes; no hypothetical new rules.
- [x] Name remains `mod-project`; valid name/description frontmatter, concise trigger-only description begins `Use when` and names the relevant routes/APIs.
- [x] Existing source map/current constraints/SOP preserved; no new flowchart, tool, multi-language example or generic scaffold needed.
- [x] Same scenario independently passes using corrected reference; no remaining ambiguity in the three tested facts.
- [x] Behavioral shaping micro-tests, combined-pressure discipline scenarios, rationalization tables and red-flag rules are not applicable to this pure reference correction.
- [x] Historical notes retained per the repository's append-only knowledge rule, with their superseded status explicit.
- [ ] Deploy through the same reviewed B2 PR after its final acceptance/CI gates; no standalone skill publication.

A fourth factual control was added after inspecting `create-project-rules.ts#canCreateProject` and #608's existing bootstrap regression: old-reference reader answered admin cannot create, quoting the stale rule. The current helper explicitly allows lead OR admin. The reference was corrected to that source; the updated-reference reader independently answered admin can create under #608 and does not gain content superuser authority. Runtime policy is unchanged; the actual denied browser subject is a consultant, and its test title now says so. Its actions/assertions are unchanged.
