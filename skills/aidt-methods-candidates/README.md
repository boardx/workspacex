# Teaching boundary remediation: methods 1.3.1 / summary 1.0.1

These immutable source candidates address observed behavior in [the fresh-round review](../../docs/evidence/aidt-native/completion-20261116/a3/fresh-round-content-review.md), using the existing [V2 requirements](../../docs/requirements/aidt-v2-full.md). Source readiness and deterministic package checks do not establish model compliance or human teaching approval.

| Observed problem | Change in the new package | Verification required |
| --- | --- | --- |
| S2 proposed simulation as a replacement for real interviews | Role play is only question/listening practice; hypotheses remain unverified. Students first draft questions, then decide which revisions to adopt. | Actual S2 response must prepare genuine research without treating a simulated participant as evidence. |
| S2 described observation/complaint/guess as though all were present | Describe only the group's recorded source categories; a guess-only group has no implied observation/complaint. | Inspect source references and wording against the actual frozen context. |
| SUM claimed completeness despite 17 truncated sources among 29 selected | Distinguish selected coordinates, visible excerpts and originals. Disclose truncated ranges and deliver a partial draft with gaps when necessary. | Inspect report text, not merely a successful source projection or export receipt. |
| SUM omitted visible V2 and evolution between historical/current return choices | Reconcile V1/V2, each question binding and return decision. Current and historical choices remain separate. | Preserve old problem/version relations; visible V2 must appear, and unread old reasons remain unknown. |
| Feedback tasks kept planning/repeating a Skill | Only new mounted content opts into one focused feedback turn, then waits for the student. | Runtime integration tests and a real configured run must verify return behavior. |

The original SUM did state the current return-to-step-5 choice. Its omission was the historical return-to-step-2 → later step-5 evolution, V2 treatment and source-scope disclosure. The old step-6 V4 excerpt was only 15 bytes, so its full reason was unread; current V7's V2 reference and return choice were visible. These packages do not rewrite that evidence or treat later student corrections as original model success.

The seven new source files put this precise marker in the first nonblank body line immediately after frontmatter:

```html
<!-- aidt-feedback-turn: return-after-student-feedback-v1 -->
```

Runtime recognizes the marker from the actual mounted Skill content, not user text or reference material. A successful focused Skill reply is feedback for the current student request; it is not stage completion, group consensus, confirmation, evidence validation or saving. Failed/unknown calls and older packages retain their existing behavior. The runtime implementation is independently tested by its owner.

The existing opt-in registry now selects 1.3.1/1.0.1 for future imports/selections. Source files are versioned separately so all old release bytes and source inputs remain available. The context verifier appends the exact new coordinates and retains previous releases. No existing thread pin, user clone or ordinary Chat selection is migrated. Builds do not install, publish, deploy or create human approval records.

```bash
pnpm --filter @repo/api exec tsx scripts/build-aidt-methods-pack.ts --check
pnpm --filter @repo/api exec tsx scripts/build-aidt-summary-pack.ts --check
pnpm --filter @repo/api exec vitest run --config vitest.aidt-isolation.config.ts
pnpm --filter @repo/api exec vitest run --config vitest.aidt-run-context.config.ts tests/aidt-run-context/approved-pack-unit.test.ts
pnpm run lint:shipped-pack-version
pnpm run lint:skill-metadata-source
```

Content assertions check that the shipped input carries the intended boundaries. They cannot prove how a supplier model will respond, whether evidence is genuine, or whether a class learns effectively. New real-model S2/SUM results must be inspected against frozen inputs before claiming these defects resolved in actual use.
