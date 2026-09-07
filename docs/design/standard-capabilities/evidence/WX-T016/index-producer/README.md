# WX-T016 existing-index producer increment

This increment connects actual upload bytes and the existing ingestion outbox to the existing `segments`, `segment_text`, and optional `segment_embeddings` tables. It adds the authenticated `POST /artifact-versions/:versionId/index` entry. Identity comes from `CurrentPrincipal`; the only request body is `{}`. The existing permission filter evaluates the explicit `content.indexFile` action against the canonical artifact project. Active jobs are not stolen by this user entry. No second job table or embedding registry is introduced.

The Kernel registers `EMBEDDING_PORT`, `ARTIFACT_INDEX_PRODUCER`, `ARTIFACT_INDEXING_SERVICE`, and `ArtifactIndexingController`. The service defaults to the existing `StructuralReviewGate`, wrapped to require a real version and the version-bound derived bytes. Missing objects fail closed. PII text stays in `review-pending`, is not disclosed by retrieval, and is not sent to the embedding provider. The original review-pending outbox item remains available for the existing human review resolver. The original parse-quality threshold remains undecided; this implementation does not invent a classifier or threshold.

## Configuration and operation

With no explicit embedding model/version, indexing is text-only. Optional embeddings use the official Python `langchain_openai.OpenAIEmbeddings`, with retries disabled and the existing trusted `KERNEL_MODEL_BASE_URL` / `KERNEL_MODEL_API_KEY`. Configure `KERNEL_EMBEDDING_MODEL_ID` and `KERNEL_EMBEDDING_MODEL_VERSION` explicitly on both services. The API uses its existing `KERNEL_DEEP_AGENT_BASE_URL`; both services use the same existing `DEEP_AGENT_SERVICE_INTERNAL_KEY`. No model-visible argument chooses the provider or credential.

Before enabling a model, an operator runs `pnpm --filter @repo/api exec tsx scripts/register-retrieval-embedding-model.ts` with the existing migration credentials and explicit model/version plus `KERNEL_EMBEDDING_DIMENSIONS`. The normal runtime role cannot register models. Registration is replayable and refuses a dimension change for the same model/version. The maintenance entry `pnpm --filter @repo/api exec tsx scripts/index-retrieval-version.ts` uses normal app credentials plus explicit `RETRIEVAL_INDEX_ORG_ID` and `RETRIEVAL_INDEX_VERSION_ID`; it is supplementary to the authenticated user route.

## Verification scope

- `api-component.txt`: 19 earlier component/real PG tests passed; this predates the user-entry and strict-review additions and is not evidence for them.
- `cli.txt`: one selected real child-process maintenance test passed; other tests were intentionally not selected.
- `python.txt`: 8 tests passed, including an actual official SDK request with deterministic transport, strict ASGI input/auth, bounded provider response, and deadline cancellation.
- `ast-final.txt`: 8 positive/mutation tests passed for the writer's exact authorization/transaction boundary.
- `lint-final.txt`: this run failed on one unrelated `pg-artifact-continuation-reader.ts` boundary; none of this increment's new readers failed. This is not a green global gate.
- `api-before.txt` and `api-after-hash.txt`: retained failures. They caught the actual aggregate version-hash scheme and the database's immutable-version trigger. The fix reuses the canonical hash; tests corrupt actual object bytes rather than weakening immutability.
- `user-entry-before.txt`: 31/32 passed; the strict request schema raised a generic 500. The controller now explicitly maps malformed input to 400.
- `user-entry-after.txt`: final 6 files / 32 tests passed, exit 0, isolated stack cleaned. This includes real production createApp user entry, real PII text remaining review-pending and absent from FTS, current write-permission denial, single-winner active leases, missing-derived rejection, and existing ingestion/review regressions.

## Remaining boundaries

Only bounded, valid UTF-8 text, CSV, and JSONL are supported. Binary PDF/Office/OCR/ASR extraction stubs are explicitly rejected. Content hashes and segment anchors derive from real bytes and immutable version records. READY PII reindex is conservatively refused because no version-specific approval proof is available to this producer.

The embedding provider is exercised with deterministic HTTP responses, not a paid model; vector quality and provider deployment are not validated. Each embedding call has bounded request/response bytes and a deadline, but a multi-segment producer has no aggregate execution deadline. Five-channel query orchestration and reranking remain separate work; this is not a claim that all of W07 is complete.

Upstream reuse: [official OpenAI embeddings integration](https://docs.langchain.com/oss/python/integrations/embeddings/openai) and [LangGraph custom routes](https://docs.langchain.com/langsmith/custom-routes). The custom Starlette app is registered through `langgraph.json` rather than a parallel server.

Exact focused commands (run from repository root):

```sh
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_retrieval_embeddings.py -q
node apps/api/scripts/tests/artifact-index-writer-boundary.test.mjs
node apps/api/scripts/lint-permission-paths.mjs
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/index-artifact-version.test.ts tests/agent-runtime/artifact-index-producer-real-db.test.ts tests/agent-runtime/langchain-embedding-client.test.ts tests/files/worker-replay-no-duplicate.test.ts tests/files/ingestion-repo-metadata-only.test.ts tests/files/review-pending-gate.test.ts
```
