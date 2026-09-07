# W12 / WX-T031–T033 memory integration delta

This is a design and component boundary, not completed long-term memory. Current
thread history and checkpoint persistence are not personal cross-thread memory.

## Reuse and existing entrances

The lockfile contains deepagents 0.7.6 and LangGraph 1.2.11. Native graph construction
already accepts `store` and additional tools; the production selector currently routes
to legacy or text-only graphs. No user memory API or memory tool consumer was found.
LangMem is not yet locked. Prefer its official `create_manage_memory_tool` and
`create_search_memory_tool` over recreating CRUD/search tools. Its documented namespace
templates resolve from trusted configurable values; org and user must both be bound.
Before dependency changes, select and inspect an exact compatible LangMem release,
including async behavior and delete support. Do not imply that documentation of main
is a locked deployment dependency.

Sources: https://langchain-ai.github.io/langmem/reference/tools/ and
https://github.com/langchain-ai/langmem/blob/main/docs/docs/guides/memory_tools.md ;
LangGraph Store persistence: https://docs.langchain.com/oss/python/langgraph/add-memory .

## Trusted identity component proposal

`ModelCallInput.trustedMemoryScope?: { orgId: string; userId: string }` is infrastructure
context, never user messages or tool arguments. The main `execute-run.ts` invokeKernel
call derives it from the claimed run requester and tenant. The provider projects one
shared contract key on fresh/resume, independently from subtask callback configuration.
Missing/blank identity must not turn into an anonymous/global namespace. Auxiliary
summarization calls and text-only derived tasks receive no memory capability.
Python must bind both values into the LangMem namespace, refuse identity changes when
resuming an existing checkpoint, and keep namespace fields outside the model schema.
The TS forwarding component alone does not claim a production memory consumer.

## Persistent Store is an unresolved deployment prerequisite

The current service Dockerfile starts `langgraph dev`; langgraph.json does not declare
a persistent Store connection. No existing production AsyncPostgresStore composition
was established in this audit. Passing `store=None` or observing platform injection is
not proof of durable PostgreSQL memory. Use the official AsyncPostgresStore with an
explicit lifecycle-owned connection, or the deployed platform's documented durable
Store after verifying actual deployment configuration. Do not create a custom memory
table or copy checkpoint data into one. Never fall back to InMemoryStore in production.
The Store API itself must not be externally usable to select another user's namespace;
network exposure/authentication needs verification alongside tool-level scoping.

## Smallest complete vertical slice

Explicitly requested personal memory creation, lookup and deletion through official
LangMem tools, backed by the verified persistent Store and consumed by the actual
production graph. Scope is private to org/user across threads. No peer main-run control,
approval UI, automatic extraction or organization-shared memory is included. Semantic
search needs a configured embedding/index and separate evidence; do not call an
unindexed listing semantic retrieval.

Acceptance: actual graph ToolCalls create/read/delete, process restart preserves values,
same-user different-thread access succeeds, cross-user/org access fails, missing scope
fails closed, fresh/resume retain binding and text-only has no memory tools. Include
Store endpoint access control, not just namespace helper unit tests. Run real PostgreSQL
through the repository's isolated test lifecycle; no unconsumed database schema.

## Implemented trusted identity component

The approved TS component now forwards `TrustedMemoryScope` under the generated shared
`MEMORY_SCOPE_CONFIG_KEY`. The main invokeKernel derives user identity from the claimed
requester; provider fresh/resume verifies scope org equals ModelCallInput.orgId and
omits memory for text-only. Tests exercise the actual executeQueuedRuns call and capture
provider HTTP bodies. This proves identity transport, not authorization of a particular
memory statement: source messageId proof, CAS revision and write idempotency required by
T032 are not implemented. There is still no production LangMem tool/Store consumer.

Upstream candidate verified by the parallel source audit: langmem 0.0.30, official PyPI
wheel SHA256 `142f040014493eebd67e1055c0642f9ab38868b5b1fde5c8f2d39add57f4ba5b`.
Both official tools support sync/async; namespace can be factory-bound outside model
arguments. Before integrating, account for manage update being upsert and search results
including namespace metadata. These are adapter policy boundaries, not reasons to rewrite
official CRUD logic. The dependency is not yet added to this repository's lockfile.
