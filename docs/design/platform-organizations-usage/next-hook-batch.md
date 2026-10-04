# Next bounded source batch

Current committed remote head: `48d1961057c64701792255643ae26fb1f18eff87`. Backend 37176092506 and harness 37176092476 completed success, including the authored PG artifact cases in existing CI. Uncommitted input-only source below has separate light unit evidence; it is not included in those green runs. Default-off composition and original-unit ledger exist; this does not imply all provider calls are admitted or measured.

## Durable child acceptance, preserving current contract

`PgSubtaskRunStore.claimQueued` creates an independently running child epoch/attempt; it does not require the original parent to hold a running lease. `PgParentRunControlReader` likewise validates child authority and the parent cancellation flag. Private model ownership must preserve this contract, not add a parent-running/active-lease business gate. Acceptance must prove: own running child and exact epoch/attempt accepted; wrong epoch/attempt, child cancellation, parent cancellation and foreign tenant rejected. A new real-PG ownership test is authored in the existing durable queue suite; not executed locally and not part of frozen529 CI. No production behavior changed.

## Actual missing provider hooks, ordered work

1. Retrieval query embedding and listwise rerank (now source-connected for trusted standard-tool runs, default-off; the following explains the original gap): `retrieve-candidates.ts` already has the authorized tenant/principal, but `EmbeddingPort.embed(text)` and `RerankPort.rerank(query,candidates)` discard that authority. Carry a trusted subject/operation context from the server use case, through the private service request, to each actual httpx vendor dispatch. Reuse the sole ledger/admission protocol rather than count the TS service envelope as vendor usage. Preserve permission filtering before rerank and reject unknown ownership when enforcement is on. Need explicit embedding input-only output bound/accounting support; do not pretend chat max_tokens covers embedding.
2. KG query embedding: `PgKnowledgeRecall.vectorNeighbors` has tenant/user but similarly drops them at `.embed(query)`. Same context path and per-HTTP hook; ensure empty candidates/cancellation are not counted as paid when no provider dispatch happened. Existing implementation can dispatch before candidates finish, so an empty eventual set can still be a real paid call.
3. Ingestion embedding: `IndexArtifactVersion.index` carries org/artifactVersion only. Derive the immutable initiating author/service authority from the actual producer metadata, not the worker identity or an arbitrary org member. Repeated segments and batches require distinct stable operation IDs and per-HTTP receipts; Python OpenAIEmbeddings splits into batches of10.
4. Embedding cosine rerank: real calls occur for the query and each candidate (`embedding-cosine-rerank.ts`). One outer rerank receipt is insufficient. Preserve per-call identity through concurrent candidate promises and account actual vendor requests only.
5. Embedding warm-up: `keep_provider_connection_warm` dispatches `embed_texts(['ping'])` after60seconds idle (checks every15seconds). This is infrastructure spend with no original human requester, not an ordinary-user default. Needs an explicit trusted service spend owner/policy before enforcement; do not assign a random member, silently ignore paid requests or turn off an existing production latency feature in this PR. Inventory/accounting must include it.
6. Native image/ASR, external research and local-model trial follow their actual adapters and ownership ports. Keep original units, actual provider receipts and finite safety/spend authorization. The successful-ASR estimate bridge is not provider admission or full failure/cancel coverage.

Configuration still required: ordinary per-user amount/window/timezone, finite spend currency/limits, verified exact physical model registration and bounds, rate/unit versions. These are not substitutes for missing hook or ownership source. The warm-up service spend owner is an additional exact business decision discovered from the actual call path.

## Acceptance for each connected path

Real vendor-transport loopback tests must prove reserve-before-dispatch, trusted tenant/user/service identity, exact reported/unknown usage, cancellation/failed/retry receipts, replay identity and no extra envelope receipt. Isolated CI PostgreSQL then proves concurrency, immutable holds/prices and RLS negatives. Deployed vendor/graph proof and new operator UI screenshots remain separate; lightweight mock tests cannot certify them.

Coverage remains10 grouped families: sourceMissing10, configurationMissing9, acceptanceMissing10. Counts classify families, not exhaustive HTTP call sites. The parent-lease assumption has moved to acceptance of existing child semantics; no business gate was added to clear a table cell.


Image source checkpoint: OpenAI Images has optional trusted standard-tool start/terminal actual-fetch accounting. Native quantity remains unknown; missing vendor Token fields remain unknown. Image success is preserved on terminal ledger failure and subsequent dispatches stop in that instance, with an explicit sanitized warning and unmatched durable start. Cross-process repair is still absent. Native admission and other image adapters remain missing; quota mode rejects before actual OpenAI dispatch. No production flag activation.


Local trial source checkpoint: authenticated local membership/capability context now reaches actual Ollama POST start/terminal. Probe remains excluded, no synthetic Agent run, total/cost unknown unless originally reported. Migration190 nullable-start PG tests await next-head remote CI. Owner218 no-DB cases and independent local8 passed; local admission and cross-process reconciliation remain missing. Sole audited unhooked transport point is ASR WebSocket; additional retrieval producers/opaque research/Bailian are still listed outside that narrow seven-point denominator.


ASR next verification boundary: default-off WS receipt subset implemented for four known server contexts, with same scoped owner/lifecycle transaction and no legacy double mirror. Await current-head remote PG exact-capture test; real recording lifecycle concurrency and deployed vendor units remain unverified. Next missing implementation is native unit admission/price/cap authority and durable cross-process terminal repair, not converting queued duration to Tokens. Other missing producers must have explicit original actor or authorized infrastructure spend owner; no synthesized run IDs or prices.


## Current source checklist after input-only admission

- Remote head `1de3579ff8d44c62c10033dd8a65d44e49f4b662` contains explicit input-only admission and operator editor. Backend37177742879/harness37177742887 pending at04:54UTC; prior48d terminal green remains historical, no cancellation or duplicated run.
- Six of seven known retrieval producer references are connected. KG/artifact ownership PG cases passed in48d CI; input-only reservation/unknown hold/enterprise finite-cost/immutable-price PG composition is newly authored, unexecuted locally.
- SDK embeddings have max_retries=0 and no input-only automatic fallback. Each actual HTTP uses its own physical UUID + exact body digest/path. Same-body independent batches must not share a slot; physical callback replay still refuses dispatch. Cross-worker business-level semantic dedup/retry authorization remains separate and incomplete.
- Whole-input facts: reader validates exact hash/completeInput/current owner/replay constraints. Actual trusted producer must account for system/user/history/pinned skills/tools/attachments/memory and transformed remote requests, with no assumption that arbitrary text is public. Verified serialized-body measurer/model deployment registrations remain missing. Fixtures are not production proof.
- Warmup embedding: explicit trusted infrastructure spend owner/policy remains missing; no random member or invented Agent run.
- Native/local admission: image/ASR/Ollama need trusted verified actual unit/counter bounds, immutable native price snapshots and shared finite cost reservation/settlement. Estimated queued PCM duration and unknown image count are not vendor billed values. Unsupported Bailian/research direct adapter entrypoints are now denied before remote side effects in opt-in quota mode; their actual hooks remain missing.
- Receipt crash repair: Python pre-vendor metadata intent/flock and conservative post-process-exit repair are in source; safe bounded lock inode GC has been independently implemented and awaits root review. ACK-to-intent crash is before vendor dispatch, leaving unmatched start; total storage failure/previously-passed concurrent checks remain open. Image/local/ASR durable cross-process repair is still missing.
- Acceptance: current-head CI, newly authored real PG input-only case, production filesystem/deployment proof, actual provider cancel/retry counters and authenticated operator screenshots remain separate. No local DB/Docker/heavy build or production configuration change.

Static inventory:7 audited actual dispatch primitives, receipt3full/4context subset; seven known retrieval producer references6connected/1missing. Whole-repository actual dispatch denominator remains unknown. All production flags remain off.
