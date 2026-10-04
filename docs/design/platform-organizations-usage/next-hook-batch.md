# Next bounded source batch

Current frozen remote head: `529488455c095a10483ed02848a6bab2e1fd8dd6`. Do not replace its pending CI with another push. Default-off composition and original-unit ledger exist; this does not imply all provider calls are admitted or measured.

## Durable child acceptance, preserving current contract

`PgSubtaskRunStore.claimQueued` creates an independently running child epoch/attempt; it does not require the original parent to hold a running lease. `PgParentRunControlReader` likewise validates child authority and the parent cancellation flag. Private model ownership must preserve this contract, not add a parent-running/active-lease business gate. Acceptance must prove: own running child and exact epoch/attempt accepted; wrong epoch/attempt, child cancellation, parent cancellation and foreign tenant rejected. A new real-PG ownership test is authored in the existing durable queue suite; not executed locally and not part of frozen529 CI. No production behavior changed.

## Actual missing provider hooks, ordered work

1. Retrieval query embedding and listwise rerank: `retrieve-candidates.ts` already has the authorized tenant/principal, but `EmbeddingPort.embed(text)` and `RerankPort.rerank(query,candidates)` discard that authority. Carry a trusted subject/operation context from the server use case, through the private service request, to each actual httpx vendor dispatch. Reuse the sole ledger/admission protocol rather than count the TS service envelope as vendor usage. Preserve permission filtering before rerank and reject unknown ownership when enforcement is on. Need explicit embedding input-only output bound/accounting support; do not pretend chat max_tokens covers embedding.
2. KG query embedding: `PgKnowledgeRecall.vectorNeighbors` has tenant/user but similarly drops them at `.embed(query)`. Same context path and per-HTTP hook; ensure empty candidates/cancellation are not counted as paid when no provider dispatch happened. Existing implementation can dispatch before candidates finish, so an empty eventual set can still be a real paid call.
3. Ingestion embedding: `IndexArtifactVersion.index` carries org/artifactVersion only. Derive the immutable initiating author/service authority from the actual producer metadata, not the worker identity or an arbitrary org member. Repeated segments and batches require distinct stable operation IDs and per-HTTP receipts; Python OpenAIEmbeddings splits into batches of10.
4. Embedding cosine rerank: real calls occur for the query and each candidate (`embedding-cosine-rerank.ts`). One outer rerank receipt is insufficient. Preserve per-call identity through concurrent candidate promises and account actual vendor requests only.
5. Embedding warm-up: `keep_provider_connection_warm` dispatches `embed_texts(['ping'])` after60seconds idle (checks every15seconds). This is infrastructure spend with no original human requester, not an ordinary-user default. Needs an explicit trusted service spend owner/policy before enforcement; do not assign a random member, silently ignore paid requests or turn off an existing production latency feature in this PR. Inventory/accounting must include it.
6. Native image/ASR, external research and local-model trial follow their actual adapters and ownership ports. Keep original units, actual provider receipts and finite safety/spend authorization. The successful-ASR estimate bridge is not provider admission or full failure/cancel coverage.

Configuration still required: ordinary per-user amount/window/timezone, finite spend currency/limits, verified exact physical model registration and bounds, rate/unit versions. These are not substitutes for missing hook or ownership source. The warm-up service spend owner is an additional exact business decision discovered from the actual call path.

## Acceptance for each connected path

Real vendor-transport loopback tests must prove reserve-before-dispatch, trusted tenant/user/service identity, exact reported/unknown usage, cancellation/failed/retry receipts, replay identity and no extra envelope receipt. Isolated CI PostgreSQL then proves concurrency, immutable holds/prices and RLS negatives. Deployed vendor/graph proof and new operator UI screenshots remain separate; lightweight mock tests cannot certify them.

Coverage remains10 grouped families: sourceMissing10, configurationMissing9, acceptanceMissing10. Counts classify families, not exhaustive HTTP call sites. The parent-lease assumption has moved to acceptance of existing child semantics; no business gate was added to clear a table cell.
