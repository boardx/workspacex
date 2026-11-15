# A — shared AIDT stage drafts

The user explicitly approved A+B in the active conversation. This implementation does not alter design-signoff status, deploy, publish, or migrate personal content.

## Implemented boundary

`packages/contracts/src/aidt-stages.ts` is the API source. GET list/current/history and PUT save live only under `/projects/:projectId/aidt/stages`. A stage is one of six integers. Saved content is a versioned, strictly typed student working draft, including discovery cards, ideas, selection notes, and explicit earlier-stage revision references. Empty/incomplete drafts are allowed; no stage completion, consensus, evidence verification, or teacher acceptance state exists.

`AidtStagesService` is default-off unless the root explicitly injects the existing ENABLE_AIDT_MODULE policy. Every operation checks a real current project member, canonical `authorize(read.published)`, and a server-side general-project + workspacex:aidt tag. The existing generic content-write role matrix (`content.renameFile`) additionally gates saving; it grants no rename capability or new project/organization role. Archived projects and disabled organizations remain readable to authorized members, but saving and even replaying a prior operation are rejected. An administrator who is not actually a project member cannot read these student drafts.

`PgAidtStageRepository` runs the project/tag/status reads, authorization, CAS, immutable revision insert, and operation receipt in one tenant transaction. The project row lock serializes two saves even when no first stage row yet exists. The organization and actual general-project membership rows are held against concurrent status/revocation changes through commit. The normal IdentityRepository interprets roles; the direct membership SELECT is only a lock. Once a removal commits, subsequent operations re-read membership and fail closed.

`aidt_stage_revisions` has org/project composite integrity and forced tenant RLS, SELECT/INSERT privileges only, and participates in the existing organization freeze and project archive policies. Current state is the latest immutable revision, not a second mutable copy. Operation IDs are unique per org/project/actor across all stages. Equal normalized retry returns the original receipt even after later revisions; a changed request with the same ID conflicts. Two same-base writers can only yield one revision; the other receives 409 with an already-authorized current draft. Source revision references must exist in this exact project and precede this stage.

No endpoint changes normal Project, Chat, Artifact, or AgentRun behavior. Private Artifact checkpoints are never imported automatically.

## Image references

Raw `idea.image` accepts only empty/absent values: data URIs, blob URLs, arbitrary local/remote URLs cannot be persisted as if an image had been uploaded. An optional `imageAttachment={attachmentId,threadId,name}` must resolve in the same transaction to a real sent image (PNG/JPEG/WebP), a noncancelled attachment, and a matching real message in a nonprivate plenary project thread belonging to this exact org/project. Private/pending/other-project attachments and forged names cannot be promoted by this service. This saves a reference, not image bytes, and does not certify research truth. Student sourceRef/photoRef prose remains explicitly unverified; it is not an upload receipt or permission grant.

## Discovery photos and editable group report

Discovery cards optionally carry `photoAttachment`, using the exact same authorized sent-image reference schema and transaction validation as idea images. Neither raw photo bytes nor private references are promoted.

Stage-six content optionally carries `summaryReport={markdown,sourceStageRevisions}`. The report is an editable working document, limited to 100000 characters and the same overall 256KiB UTF8 request limit. Up to six distinct stage sources must identify actual stored revisions in this project. A saved stage-six historical revision can be a report source; an uncreated self-reference cannot. Non-sixth-stage writes containing a report are invalid. Older versions with no report remain fully readable. Report revision/history, CAS, actor/time and idempotency reuse the existing stage save transaction. No separate endpoint, auto-confirmation, fabricated missing data or personal-checkpoint migration is added.

Additional unit cases cover authorized discovery photo roundtrip; other-project/private/name-mismatched photo rejection; real report sources including stage-six history; absent sources and future self-reference rejection; report edit history; idempotency protecting existing report text; stage-six-only rules; source uniqueness and content limits. The two deliberately invalid image inputs are built as raw validation requests so that contract typechecking still rejects such values in typed clients.

## Local verification

47/47 unit/protocol tests passed at 2026-11-15 00:01:58 UTC, duration 2.63s, with one worker:

```
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-ui-v3-bin:$PATH pnpm --filter @repo/api exec vitest run --config vitest.aidt-stage-unit.config.ts
```

The fixture uses a serialized in-memory transaction port and the real existing authorization logic. It verifies CAS, immutable history, retry receipts, operation conflict, member revocation, read-only lifecycle, administrator isolation, cross-project/org denial, sources, discovery card preservation, validated image-reference behavior, default-off behavior, protocol errors (including explicit 413 for oversized input) and UTF8/field limits. It is not PostgreSQL acceptance evidence.

Mechanical permission-path, architecture dependency, and interface error-leak scripts passed. API has no ESLint configuration; an attempted direct ESLint invocation could not run and is not claimed as a pass. Parent/QA owns unified API typechecking and real PG/HTTP/browser verification, including actual transaction/RLS behavior, refresh/second-member restoration, and concurrent requests. No production or load-test acceptance is implied.
