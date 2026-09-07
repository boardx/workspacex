# WX-T016 hybrid query increment

The default `organization-index` remains existing FTS. Explicit `organization-hybrid` composes the existing `retrieveCandidates`, `PgSegmentRetriever`, query planner, RRF fusion and permission filter. `queryTask` is only accepted for this explicit profile. Planned channels are returned as `retrievalPlan`; there is no invented always-five trace.

Canonical artifact project membership is disclosed per source before fusion and before any text reaches the reranker. The vector channel keeps the existing `embedding-similarity` propagation path. The current profile accepts only effective, in-scope primary uploaded files, excluding private notes, pending/revoked rows, synthesized/confidential sources and interview subjects. The raw claim statements, opposing identifiers and withheld references are not projected to the knowledge tool. Every result is read and authorized again after reranking and carries the actual immutable artifact-version ID plus actual indexed-content digest and anchor. Late withdrawal or changed content fails the request.

The existing planner can request graph traversal, but this profile has no trusted graph-seed resolver. Such a request explicitly fails before the external model call. This is not a claim of full graph/consent coverage. Existing FTS/vector/metadata/claim paths are exercised using actual database tables; the claim channel contributes authorized original source segments, not unreviewed raw claim text.

## Official rerank reuse and deployment

Uses installed `langchain-classic==1.0.8` [LLMListwiseRerank](https://reference.langchain.com/python/langchain-classic/retrievers/document_compressors/listwise_rerank/LLMListwiseRerank), backed by official `ChatOpenAI`. It calls the documented public `reranker` Runnable's async `ainvoke`. In this installed version, `acompress_documents` delegates synchronous work to an executor, so that entry point would not preserve cancellation of provider work. No private helper or custom ranking algorithm is used.

Set explicit `KERNEL_RERANK_MODEL_ID` and `KERNEL_RERANK_MODEL_VERSION` on API and Python service. Existing `KERNEL_MODEL_BASE_URL` / `KERNEL_MODEL_API_KEY` remain the provider connection and credential source. The same existing `DEEP_AGENT_SERVICE_INTERNAL_KEY` authenticates the internal route. Kernel composes the hybrid runtime only when both embedding and rerank are configured. An explicitly requested unavailable hybrid profile fails instead of silently reporting FTS as hybrid. No new secret store, registry, index table or queue is introduced.

Input candidate counts, UTF-8 text bytes, request/response bytes and provider deadlines are bounded. Redirects and retries are disabled. Ranking must be a permutation of real input IDs; foreign, duplicate and omitted IDs are refused. Provider errors are projected as fixed safe errors. No claim of paid-model relevance quality or production provider deployment is made.

## Evidence

- `rerank-before.txt`: real initial missing-module failure before implementing the adapter.
- `python.txt`: 14 tests passed, including the actual official runnable and SDK over deterministic transport, malformed ranking, authentication and deadline checks, and previous embeddings regressions.
- `api-component.txt`: 4 files / 64 tests passed against isolated PG and real local HTTP rerank, including the 5 new hybrid tests and previous organization/engine regressions. Stack cleaned, peak 5 connections. This predates the new production hybrid DI test.
- `permission-lint.txt`: global permission lint passed, no new allowlist.
- `uv-lock.txt`: existing cached dependency resolved into the lockfile.
- `api-final.txt`: final 4 files / 65 tests passed, including real production createApp DI → claimed human run → configured embedding/rerank HTTP → actual PG. Wrong tenant/lease returns 403; unauthorized project text never reaches reranking. Stack cleaned, peak 9 connections. The HTTP model responses are deterministic fixtures, not paid-provider quality evidence.
- Parent reported API typecheck session 82920 exit 0; the final production test was added subsequently, so this report does not imply that the later test file was included in that earlier typecheck.

Commands:

```sh
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_retrieval_rerank.py apps/deep-agent-service/tests/test_retrieval_embeddings.py -q
node apps/api/scripts/lint-permission-paths.mjs
node --import tsx packages/contracts/scripts/generate-standard-context-schema.ts --check
node --import tsx packages/contracts/scripts/generate-retrieval-rerank-schema.ts --check
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/organization-hybrid-retrieval.test.ts tests/agent-runtime/organization-context-source.test.ts tests/kernel/retrieval-five-channels.test.ts tests/kernel/retrieval-fts-first-class.test.ts
```
