# Platform organizations, plans and AI accounting — issue #5261

Status: implementation in progress, not production-ready. One ad hoc issue and one direct-main draft PR own the entire request. Milestones below are internal dependencies, not separate PR deliveries. Owner: delegated platform-org-plans worker. Merge coordination belongs to thread 01a0ffe1-0b39-771b-a431-f394760a401a.

## Constraints and activation decisions

Work in `/tmp/wsx-platform-org-plans` from `caf445c3c65eab8e614ea9ecd60cfaa112879f46`. Shared Mac checkout is read-only and has unrelated staged/dirty edits. No reset/stash/cleanup, no production SQL, no security configuration changes, no deployment or self-merge. Formal release has priority: do not start local DB/Docker or heavy builds. Normal hooks and CI remain gates. No feature_list status changes.

Ordinary/free configuration must specify amount, period, timezone, warning/degrade/stop thresholds, permitted fallback models and their final finite budget. Monetary budgets additionally require an authoritative versioned price table and currency. Specify service-principal attribution and whether the same person receives independent budgets in each organization. No guessed production defaults. Enterprise bypasses only product token quota; safety, residency, provider limits and explicit authorized monetary protection continue.

## Existing implementation to reuse

| Capability | Existing authority | Observed boundary / required extension |
|---|---|---|
| Platform operators | `interface/guards/platform-operator.guard.ts` and `platform-member.controller.ts` | Reuse operator guard; superuser-only admin grant remains separate |
| Organizations | `organizations` with RLS, `pg-platform-member-repository.ts` | Member catalog derives org IDs from credentials/kernel_user_org_ids; misses empty orgs and intentionally filters kinds |
| Accounting | `application/agent-run/ports.ts`, `meter-run-usage.ts`, `infrastructure/auth/pg-token-usage-repository.ts`, migration F159 | One writer to `token_usage_events`; org/user/provider/model/run, input/output and total; primarily run/provider envelopes, not every internal request |
| User quota | `token-quota-ports.ts`, `get-token-quotas.ts`, `set-token-quota.ts`, `pg-token-quota-repository.ts` | Configured member monthly amounts and org allocation locks are not request admission reservations |
| Aggregate usage | `get-usage-report.ts`, `pg-token-quota-repository.ts`, `usage-monitor-tab.tsx` | Existing four-window org totals, member×model matrix, member ranking and model distribution; lacks explicit timezone/comparison/quality/input-output/details/self-only routes |
| Limit settings/events | `pg-limit-rule-repository.ts`, `limit-rules-live.tsx`, `limit-policy-tab.tsx` | Reuse configuration concepts, not proof of universal per-call enforcement; do not add a second ledger |
| Run lifecycle | `invoke-kernel.ts`, `execute-run.ts`, persisted execution/lease/checkpoint events | Execution attempts are not identical to real provider attempts; downstream failures cannot erase billed usage |
| Native model runtime | `apps/deep-agent-service/src/deep_agent_service/model.py`, graph/harness and native tools | Separate Python process using ChatOpenAI, task/subagent/tool loops; requires per-request transport accounting rather than summed gateway result |
| Native ASR usage | `infrastructure/recording/in-memory-asr-usage-meter.ts` | In-memory audio-native accounting is not persistent token accounting; never translate seconds into invented tokens |

## Information architecture and access

Platform navigation: Organizations → searchable/paginated catalog (all formal `kind=organization` rows, including zero-member organizations; personal-local and platform containers remain private) → basic details, member count, plan and configuration state, AI usage, audited plan history. No delete. `kind` describes identity shape; `plan` is a separate entitlement policy. Legacy organizations show unconfigured plan until a deliberate action sets one.

Organization AI usage: explicit time window/timezone and model filter; input/output/total, reported/estimated/unknown coverage, daily trend and previous equal-length window; member ranking → individual usage; provider+model distribution; member×model intersection → paginated call detail. Individual view shares the same ledger and window. Project IDs are preserved from trusted context now, with explicit unassigned rows. No prompt, response or other content in usage APIs.

Org admin sees only own org; ordinary member only self. Platform operator catalog/usage access is audited. Platform catalog cannot use application-wide SQL bypass: design a separate least-privilege catalog credential and restricted projection/policy, explicitly provisioned through the established infrastructure release process. No fallback to table owner, diagnostics reader, or app_rw SECURITY DEFINER scan. An absent catalog credential is unavailable, not an empty organization list.

## Internal milestones and completion criteria

1. **Ledger receipt foundation (implemented in draft).** Reuse authority; immutable unique receipt ID; distinguish reported total from unknown and legacy; trusted project/thread/agent context; bounded transient accounting retries with same identity; summary/script regeneration separately counted. Provider-envelope completion is counted before checkpoint return/downstream persistence. Focused unit tests plus real DB replay/RLS verification required. This is not durable delivery or every-provider-attempt coverage.
2. **Catalog and audited plans (source implemented; real PG/UI evidence pending).** Controlled catalog enumerates empty orgs; search/pagination stable with details; separate versioned plan storage, optimistic edit and audit in one transaction. Existing organizations remain unconfigured. Operator/unauthenticated/nonoperator/cross-tenant tests; real migrated DB, actual empty-org UI screenshots. No deletion or kind mutation.
3. **Every provider request and durable receipts.** A trusted context envelope spans org/user-or-service, project/session/task/run/parent agent, execution attempt and unique provider request attempt. Persist start and terminal receipts/outbox before claiming complete; reconcile late provider usage through append-only corrections. Retry the same receipt, never retry the model to repair accounting. Internal Python attempts report to the same authority with authenticated request ownership. Disable aggregate-envelope addition for paths reporting child attempts to avoid double counting.
4. **Shared atomic admission/policy.** Separate plan/token/cost state; reserve maximum safe input+output allowance under `(org,user,period)` transaction lock with idempotent request identity; output caps enforce reservation. Concurrent requests and workers use the same admission port. Settle once, account charged failures, retain conservative holds for unknown charge, explicit reconciliation/expiry. Enterprise skips product quota only. Hard stop/fallback/warning do not silently bypass finite cost protection. No service retry or continuation bypass.
5. **Compatible fallback and bounded cost.** Approved lower-cost route must satisfy organization provider/model policy, data residency, required vision/tools/context capacity and task capability promises. Show model/policy transition in UX. Incompatible route denies with actionable explanation. Apply finite fallback budget and final stop; price version/currency is explicit, unknown price cannot masquerade as zero.
6. **Same-ledger analytics.** Org and individual APIs share predicate/window snapshot; filter provider+model/member/project; summaries equal details including unattributed/unknown rows. Use half-open absolute windows and explicit IANA timezone for display buckets. Comparison is the preceding equal-length window, not an unexplained percentage. Late corrections and quality coverage are consistent. User/org/admin/platform permission-negative tests. Screenshots verify actual endpoints and distinguish fixtures from live evidence.
7. **Full verification and review.** Test real DB append-only/RLS, receipt replay, concurrent reservation, crash/outbox recovery, stream cancel/missing usage, billed failure/retry, compatible and denied fallback, permission negatives. Assert provider inventory coverage rather than only grep counts. Normal hooks/CI and independent security review; no claim of completed feature until these gates and complete UI evidence pass. One final draft PR remains with the unique issue until scope is complete.

## Provider coverage inventory (not yet complete)

| Path | Actual source boundary | Current change |
|---|---|---|
| Primary Chat / digital-agent gateway | `configured-model-provider.ts`, `deep-agent-model-provider.ts`, `deep-research-model-provider.ts` through `invoke-kernel.ts` | Envelope receipts; control return now counted; provider HTTP/preflight/internal request distinction remains |
| History compaction | `execute-run.ts` L2 `deps.model.complete` | Separate receipt now added; direct executor compaction unit test |
| Skill script regeneration | `execute-run.ts` regenerate callback | Separate receipt now added; helper tests, actual sandbox regeneration integration not run |
| Python root/task classification/child agents/Skills/workflows | `deep_agent_service/model.py`, graph/harness and native tools | Not instrumented per real request; aggregate gateway receipt must not be claimed sufficient |
| Digital interview and guided research | `infrastructure/interview/workflow/digital-interview-model-config.ts`, `research` workflows | Not newly instrumented or policy-enforced |
| Embedding / rerank / KG | `retrieval/langchain-embedding-client.ts`, `langchain-rerank-client.ts`, KG embedding/extraction clients | Missing uniform initiating-user/service attribution and per-request ledger bridge |
| Background title/followup/feedback/error summary | model config factories under chat/feedback/logging | Missing common request admission/accounting; service identity must be explicit |
| Vision / images | `bailian-vision-extractor.ts`, `bailian-image-provider.ts`, `openai-image-provider.ts`, standard-image-service | Native units and any provider-reported tokens need separate dimensions |
| Audio transcription / speech | `configured-realtime-asr-provider.ts`, audio-asr/standard audio providers and Python tools | Native seconds/channels remain native; no fabricated conversion |
| Trial-run / local model | skill trial-run and `identity/http-local-model-runtime.ts` | Existing trial path intentionally optional usage; full requirement needs deliberate admission/attribution change |

Provider cache/reasoning token details are usually subsets of input/output, not extra totals. Preserve raw numeric details with explicit units and provenance; never add them again to total. Unknown reports mean coverage missing, not zero spend. Estimate only with an identified estimator/version and never relabel it reported. Token usage is not monetary cost or member performance.

## Current evidence and blocking gates

API focused tests use no DB, Docker or real provider; mock SQL parameter tests are not PostgreSQL evidence. Additive migration was authored, never applied. No production organization plan/limit changed. UI was not changed and no UI screenshot exists. Real migration, RLS/replay/concurrency, Python/HTTP attempt integration and durable delivery remain unverified. `pnpm harness readiness` succeeded and showed unrelated CLR queue; user direct assignment is the reason for this ad hoc queue exception. No coordinator identity/credential was provided, so no fabricated registry identity or lease/loop has been created.

Existing shared hooks are preserved. Independent review found pre-dispatch metering and paused-envelope misclassification; both were corrected and regression tests added. Full feature cannot be declared complete from this foundation. The current practical gate is an approved isolated CI/runtime verification environment for DB and providers; local release resources are deliberately untouched.

## Catalog source milestone

The platform organizations route, operator guard, bounded search/keyset pagination, empty formal org catalog, tenant-scoped details, versioned plan edits and atomic audit are implemented. UI uses live APIs and displays unconfigured plans and pending enforcement. The metadata-only NOLOGIN catalog group provisioning script is outside automatic migrations; no production permission or credential changes were made. Application, owner and diagnostic credentials are rejected as catalog fallbacks. Local/platform internal containers are excluded without changing kinds. Real PostgreSQL migration/provisioning/authorization tests are authored for isolated CI, not executed locally.

Configured provider failures preserve reported usage for empty content, failed streaming HTTP responses and stream consumer/transport failure. Receipts remain gateway envelopes; durable delivery, universal provider-attempt accounting and quota admission are incomplete.
