# Survey Markdown Source Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned Markdown source layer to persistent surveys, deterministically compile design Markdown into the current survey runtime, and freeze source plus compiled content when collection starts.

**Architecture:** Keep `survey_workspaces.document` and `SurveyService` as the organization-scoped aggregate and transaction boundary. Add a source-document submodel and a pure Markdown compiler in contracts; the service accepts source saves, derives the existing `title`, `questions`, and report-template projection from the compiler, and retains legacy structured drafts through deterministic bootstrap. Publishing freezes the Markdown source and compiled projection in the existing publication snapshot.

**Tech Stack:** TypeScript, Zod, NestJS, PostgreSQL JSONB aggregate, React-compatible REST contracts, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-survey-markdown-source-design.md`

## Global Constraints

- Markdown is the only editable source for AI-generated survey design, publication settings, report templates, and reports; structured fields are parser projections.
- Parse failures return line/column diagnostics and preserve the submitted source unchanged.
- Preserve organization isolation, owner hiding, existing publication tokens, responses, attachment claims, reports and template-library behavior.
- Existing published surveys and historical answers retain their existing frozen snapshots; do not auto-rewrite them.
- Starting collection atomically freezes source Markdown, the compiled projection and a content hash.
- Keep changes additive and use the existing `SurveyService`, `PgSurveyRepository`, `SurveyController`, and `survey_workspaces` aggregate; do not introduce a parallel survey repository or table.
- No new runtime dependency is allowed.
- Tests must use strict TypeScript and retain current survey regression coverage.

## Review Focus

- Malformed Markdown with an otherwise valid prior draft must return source diagnostics without mutating either the old projection or the newly submitted source; Task 1 and Task 3 pin this.
- Two visually equivalent documents with different ordering/whitespace must compile deterministically and have a stable content hash only after canonical serialization; Task 1 pins this.
- A legacy structured draft must bootstrap exactly once into source documents without changing its visible questions or report template; Task 2 pins this.
- A stale `expectedVersion` must not freeze a source snapshot or overwrite a newer source revision; Task 2 and Task 3 pin this.
- Published legacy surveys must remain publicly fillable and reportable without requiring Markdown migration; Task 2 regression pins this.

---

### Task 1: Define Markdown source contracts and a deterministic design compiler

**Files:**
- Create: `packages/contracts/src/survey-source.ts`
- Modify: `packages/contracts/src/survey-runtime.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/tests/survey-source.test.ts`

**Interfaces:**
- Consumes: `SurveyDraftInputSchema`, `SurveyWorkflowQuestionSchema`, and `SurveyReportTemplateSchema`.
- Produces: `SurveySourceDocumentSchema`, `SurveySourceDiagnosticSchema`, `SurveyCompiledDraftSchema`, `parseSurveyDesignMarkdown(markdown: string): SurveySourceParseResult`, `serializeSurveyDesignMarkdown(draft: SurveyDraftInput): string`, and `sourceContentHash(documents: readonly SurveySourceDocument[]): string`.

- [ ] **Step 1: Write failing compiler tests**

```ts
it("parses design Markdown into a title, questions, and source ranges", () => {
  const result = parseSurveyDesignMarkdown("# 客户满意度\n\n## Q1 [single, required]\n您会推荐我们吗？\n- 会\n- 不会\n");
  expect(result).toMatchObject({ ok: true, draft: { title: "客户满意度", questions: [{ type: "single", required: true, options: ["会", "不会"] }] } });
  expect(result.sourceRanges["Q1"]).toEqual({ line: 3, column: 1 });
});

it("reports line diagnostics without returning a compiled draft", () => {
  const result = parseSurveyDesignMarkdown("# 标题\n\n## Q1 [single]\n没有选项\n");
  expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ line: 3, code: "OPTIONS_REQUIRED" })] });
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `pnpm --filter @repo/contracts exec vitest run tests/survey-source.test.ts`

Expected: FAIL because no Markdown source contract or compiler exists.

- [ ] **Step 3: Implement strict source schemas and the pure compiler**

Define document kinds `design`, `publication`, `report_template`, and `analysis_report`; each document has `markdown`, `revision`, `contentHash`, `updatedAt`, and parser status. Keep Markdown syntax deliberately small: H1 title, H2 question declarations, plain prompt text, unordered options, and fenced `survey` metadata for supported advanced attributes. The parser may accept legacy-normalized Markdown only through `serializeSurveyDesignMarkdown`; it must never silently invent an unsupported question type or ignore an invalid rule. Derive diagnostics with 1-based source positions.

- [ ] **Step 4: Add canonical serialization and hash tests**

Write tests that serialize a valid `SurveyDraftInput`, parse it back to an equivalent projection, and prove that the hash includes document kind plus canonical content order. Test an unsupported type, duplicate question identifier, empty option, and invalid logic reference.

- [ ] **Step 5: Run contract tests and typecheck**

Run: `pnpm --filter @repo/contracts exec vitest run tests/survey-source.test.ts && pnpm --filter @repo/contracts typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the contract slice**

```bash
git add packages/contracts/src/survey-source.ts packages/contracts/src/survey-runtime.ts packages/contracts/src/index.ts packages/contracts/tests/survey-source.test.ts
git commit -m "feat(survey): define markdown survey source contract"
```

### Task 2: Persist source revisions and freeze compiled source at publication

**Files:**
- Modify: `packages/contracts/src/survey-runtime.ts`
- Modify: `apps/api/src/application/survey/survey-service.ts`
- Modify: `apps/api/src/infrastructure/survey/pg-survey-repository.ts`
- Modify: `apps/api/tests/survey/survey-runtime.test.ts`
- Modify: `apps/api/tests/survey/survey-persistence.test.ts`
- Create: `apps/api/tests/survey/survey-source-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 `SurveySourceDocument`, `SurveyCompiledDraft`, parser and serializer; existing `SurveyRecord`, `SurveyRepository.transact`, `SurveyService.create/save/startCollection`, and publication snapshot.
- Produces: additive `source` and `compiledVersion` fields on `SurveyRuntime`; `SurveyService.saveSource(orgId, actor, id, expectedVersion, documents)` and a publication source snapshot that contains immutable documents, compiled draft, and hash.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it("bootstraps one equivalent design source for a legacy draft without changing its projection", async () => {
  const legacy = await service.create(org, owner, structuredDraft);
  const loaded = await service.get(org, owner, legacy.id);
  expect(loaded.source.documents.design.markdown).toContain("# 真实问卷");
  expect(loaded.questions).toEqual(structuredDraft.questions);
});

it("freezes source and compiled projection when collection starts", async () => {
  let model = await service.saveSource(org, owner, id, 1, sourceDocuments);
  model = await service.startCollection(org, owner, id, model.version);
  expect(model.publication?.sourceSnapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(service.saveSource(org, owner, id, model.version, changedDocuments)).rejects.toMatchObject({ code: "closed" });
});
```

- [ ] **Step 2: Run lifecycle tests and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/survey-source-lifecycle.test.ts`

Expected: FAIL because the aggregate has no source revision or publication source snapshot.

- [ ] **Step 3: Add backward-compatible hydration and source save**

In `SurveyService.revisions`, add source only when absent by serializing the existing draft; never overwrite a present source document. `saveSource` parses all required editable documents before incrementing the aggregate version, updates the source revision atomically, and writes only the parsed projection to existing runtime fields. Preserve existing `save` as a legacy compatibility path during migration, but route it through serialization rather than allowing a competing authoritative model.

- [ ] **Step 4: Freeze source inside the existing publish transaction**

Extend `startPublication` to deep-copy source documents, compiled projection and aggregate source hash into `publication.sourceSnapshot`. Keep `publication.questions` for public-form compatibility but derive it from the frozen compiled projection. Ensure legacy publication objects without a source snapshot still load, submit responses, close, and generate reports as before.

- [ ] **Step 5: Add stale-write and legacy-publication regression tests**

Test a stale source save, source parse rejection, legacy collecting document with no source snapshot, and a direct public submission after source-enabled publication. Assert rejected changes leave document, projected questions, version and publication snapshot byte-for-byte unchanged.

- [ ] **Step 6: Run service and persistence regressions**

Run: `pnpm --filter api exec vitest run tests/survey/survey-runtime.test.ts tests/survey/survey-persistence.test.ts tests/survey/survey-source-lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the aggregate slice**

```bash
git add packages/contracts/src/survey-runtime.ts apps/api/src/application/survey/survey-service.ts apps/api/src/infrastructure/survey/pg-survey-repository.ts apps/api/tests/survey
git commit -m "feat(survey): persist markdown source revisions"
```

### Task 3: Expose source read/save commands without weakening existing endpoints

**Files:**
- Modify: `packages/contracts/src/survey-runtime.ts`
- Modify: `apps/api/src/interface/controllers/survey.controller.ts`
- Modify: `apps/api/tests/survey/survey-http.test.ts`
- Create: `apps/api/tests/survey/survey-source-http.test.ts`

**Interfaces:**
- Consumes: Task 1 command/result schemas and Task 2 `SurveyService.saveSource`.
- Produces: `GET /surveys/:id/source`, `PUT /surveys/:id/source` with `{ expectedVersion, documents }`, and existing runtime responses enriched with source status; errors retain existing 400/404/409 semantics.

- [ ] **Step 1: Write failing HTTP boundary tests**

```ts
const source = await request(`/surveys/${id}/source`);
expect(source.status).toBe(200);
expect((await source.json()).documents.design.markdown).toContain("# HTTP私有问卷");

const invalid = await request(`/surveys/${id}/source`, "PUT", { expectedVersion: version, documents: invalidDocuments });
expect(invalid.status).toBe(400);
expect(await request(`/surveys/${id}/source`, "GET")).toEqualSource(previous);
```

Also assert another owner and another organization receive the same `404`, stale save receives `409`, and an existing `PUT /surveys/:id` regression continues to return the current runtime projection.

- [ ] **Step 2: Run HTTP tests and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/survey-source-http.test.ts`

Expected: FAIL because source routes and command schemas do not exist.

- [ ] **Step 3: Add exact transport envelopes and controller routes**

Use strict Zod schemas for read and save envelopes. The controller delegates all compilation, tenancy, ownership and version enforcement to `SurveyService`; it must not parse Markdown itself. Map syntax/semantic source diagnostics to a structured `400`, version conflict to `409`, and invisibility to the existing `404` behavior.

- [ ] **Step 4: Run HTTP, typecheck and lint verification**

Run: `pnpm --filter api exec vitest run tests/survey/survey-http.test.ts tests/survey/survey-source-http.test.ts && pnpm --filter api typecheck && pnpm --filter api lint`

Expected: PASS.

- [ ] **Step 5: Commit the HTTP slice**

```bash
git add packages/contracts/src/survey-runtime.ts apps/api/src/interface/controllers/survey.controller.ts apps/api/tests/survey
git commit -m "feat(survey): expose markdown source commands"
```

### Task 4: Verify the migration boundary and document the next implementation slices

**Files:**
- Modify: `apps/api/tests/survey/survey-source-lifecycle.test.ts`
- Modify: `apps/web/tests/ui/survey-runtime-client.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-survey-markdown-source-design.md` only to add verified implementation notes if behavior differs from the specified migration boundary
- Modify: `.agents/skills/mod-survey/SKILL.md` by appending one verified source-migration learning

**Interfaces:**
- Consumes: source endpoint and runtime projection from Tasks 1–3.
- Produces: evidence that legacy and source-enabled survey records coexist, and a stable base for separate UI, publication, response, report and AI-generation plans.

- [ ] **Step 1: Write a client parsing regression test**

Add a `survey-runtime-client.test.ts` case that receives a runtime with source metadata and a legacy runtime without it. Assert both parse; the client must not synthesize or mutate Markdown locally.

- [ ] **Step 2: Run the client test and confirm RED**

Run: `pnpm --filter web exec vitest run tests/ui/survey-runtime-client.test.ts`

Expected: FAIL until the client schema accepts the additive source fields.

- [ ] **Step 3: Extend only schema consumption and diagnostics types**

Update the client to consume the server contract additions. Do not introduce the editor UI in this task and do not call the source endpoint from a background effect; source editing is owned by the following UI slice.

- [ ] **Step 4: Run cross-layer regression verification**

Run: `pnpm --filter @repo/contracts typecheck && pnpm --filter api exec vitest run tests/survey/survey-source-lifecycle.test.ts tests/survey/survey-source-http.test.ts && pnpm --filter web exec vitest run tests/ui/survey-runtime-client.test.ts && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Record the verified module learning and commit**

Append a concise, evidence-backed entry to `mod-survey/SKILL.md` explaining that legacy structured aggregates bootstrap source once while published snapshots never auto-migrate. Then commit only the relevant test, client and learning files.

```bash
git add apps/api/tests/survey/survey-source-lifecycle.test.ts apps/web/tests/ui/survey-runtime-client.test.ts .agents/skills/mod-survey/SKILL.md
git commit -m "test(survey): verify markdown source migration boundary"
```

## Plan Self-Review

- Spec coverage: Tasks 1–3 implement Markdown source, diagnostics, deterministic projection, versioned persistence, frozen publication snapshots and source API. Task 4 verifies legacy compatibility and establishes the interface required by the separate design, collection, response, report and AI-generation slices.
- Deliberate exclusions: visual redesign, publication UI, response drawer, Markdown report reader, AI generation and export are separate subsystems and will receive their own plans after the source contract is merged.
- Type consistency: `SurveySourceDocument` and `SurveyCompiledDraft` are defined in Task 1, persisted by Task 2, and transported by Task 3; Task 4 only consumes those interfaces.
- Review-focus coverage: Task 1 covers malformed/canonical Markdown; Task 2 covers bootstrap, stale freeze and legacy public behavior; Task 3 covers non-mutating error responses and tenancy; Task 4 covers client compatibility.
- Scope: each task finishes an independently testable boundary; no task requires an unreviewed UI implementation or a new dependency.
