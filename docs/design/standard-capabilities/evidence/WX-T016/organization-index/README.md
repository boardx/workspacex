# WX-T016/T017 — Existing organization index FTS and version-pinned read

This incremental profile extends the existing four context tools; it does not introduce another retrieval or permission engine. `wx_knowledge_search` defaults to the existing current-thread/extracted-file behavior. Explicit `scope: "organization-index"` uses `PgSegmentRetriever.fts`; `wx_knowledge_read` accepts the returned stable `segment:<id>` and exact version. Production Kernel composes `OrganizationContextSource` alongside `StandardContextSource`.

Each indexed hit is joined to its actual segment, artifact version, artifact and anchor. Existing `disclose` receives that artifact's **canonical project**, including during organization-wide searches. Canonical/index origin, version and project must agree. The first profile accepts only effective, in-scope, non-confidential, non-synthesized uploaded file/photo segments without interview subjects. Known denied source IDs cannot bypass these checks. Search rechecks each returned source; read rechecks current access and exact text version. Version consists of the real artifact-version ID plus SHA-256 of the actual indexed UTF-8 content, so a changed extraction/index cannot masquerade as the previous citation. Returned `contentKind: "indexed-segment"` is not a promise of the complete original file. Storage keys are not projected.

## Real evidence

Commands, executed from the repository root:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/organization-context-source.test.ts tests/agent-runtime/standard-context-source.test.ts
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_context_tools.py -q
node apps/api/scripts/lint-permission-paths.mjs
```

- `api.txt`: 13/13 passed, exit 0, isolated PostgreSQL stack cleaned by the canonical wrapper. Includes real production `createApp` HTTP, actual claimed human run/lease authority, correct source IDs/versions/anchors, project membership and revocation, private/foreign/unsupported sources, changed indexed bytes, forged requester/tenant/lease, and existing extracted-object-store source regressions.
- `python.txt`: 8/8 passed, exit 0. The official LangChain tool wrapper consumes the generated schema, preserves explicit scope and canonical citation, injects trusted identity, and rejects unsupported filters/invalid gateway responses. HTTP is MockTransport here; API evidence above supplies real HTTP/PG coverage.
- `permission-lint.txt`: exit 0. Existing guarded-read lint; no allowlist added.
- `api-first.txt`: earlier 11 passed / 2 HTTP tests deliberately excluded before Kernel wiring. Not counted as HTTP evidence.

Fixtures write the existing `segment_text` projection with real artifact/version/segment/anchor FK records. They **do not** demonstrate that a newly uploaded document is indexed by a production ingestion worker, nor a live model choosing this tool. No fixture embeddings or reranker are presented as production capabilities.

## Remaining scope

This is a bounded search over the existing primary-file index: at most 100 raw FTS candidates are considered, then visibility is applied, and up to 20 authorized results returned. Hidden candidates can occupy the candidate cap; empty/truncated flags do not promise exhaustive organization coverage. Explicit `projectId` requires project authorization and includes organization-level sources plus that project's eligible sources. Unsupported filters remain rejected by strict shared schemas.

Five-channel retrieval exists in `PgSegmentRetriever`, but this increment does not claim production embedding/rerank providers, five-channel orchestration, interview consent binding, synthesized/confidential source processing, indexing completeness, or full document reading. WX-T016 remains partially implemented against the full original backlog; this evidence closes only the named usable profile and its WX-T017 indexed-segment read path.
