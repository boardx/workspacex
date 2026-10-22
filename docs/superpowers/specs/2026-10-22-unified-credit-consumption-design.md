# Unified model usage and credit consumption

Status: proposed for written design review. No runtime implementation is claimed.

## Requested outcome

Every model request made by WorkSpaceX must have an attributable usage receipt and credit settlement. This includes main and auxiliary calls, streaming, retries, background jobs, tools, private Python runtimes, embeddings, image generation, speech recognition, and local models. A platform-wide switch controls whether available credits are required **before** dispatch. Turning it off never turns off accounting.

The user already approved the reference token tariff: 1 credit = 1000 tokens, rounded up to 0.01 credit per physical request, reserve before dispatch and settle idempotently from actual usage. Personal and organization accounts remain separate. Stripe subscription does not grant recharge credits automatically.

## Findings from the current code

- `PgTokenUsageRepository` is the unique token ledger writer. `startRequest` writes durable request starts and `record` writes terminal usage; the latter has bounded transient retries but no durable credit settlement.
- `PgAiAdmissionRepository` reserves token/cost policy budgets. Those are organization usage limits, not the recharge wallet. They must remain independent controls.
- `requestUsageObserver` covers main and some auxiliary agent calls. `meter-run-usage` currently catches terminal metering errors, leaving a crash/outage gap.
- Private runtimes also insert starts through `PgRuntimeModelUsageRepository`; wrapping only the public model port misses these calls.
- Local, retrieval, image and ASR request accounting currently have separate rollout flags in `kernel.module.ts`.
- `credit_wallets` and `credit_transactions` currently use integer credits and only purchase/bonus/grant ledger entries. Their contracts and existing recharge calculations require coordinated precision changes.
- There are model calls outside AgentRun, including thread titles, follow-up suggestions, design, surveys, feedback and background knowledge processing. They cannot inherit ownership from a run that does not exist.

## Accounting boundary

Use one shared credit-accounting application port with a PostgreSQL implementation, invoked by the existing durable start and terminal receipt boundaries. Every actual provider attempt receives a stable request ID. Retries after ambiguous provider responses retain their original ID; a genuinely new paid attempt receives a new ID.

At a start, resolve a trusted payer, atomically reserve credits, then persist the request start before network dispatch. At a terminal receipt, persist actual usage and a credit settlement work item in the same transaction. Settlement of that work item updates the wallet, releases the hold, writes one consumption ledger entry, and marks the item settled atomically. Retry the work item after crashes; a lost acknowledgement must never repeat a debit.

The model-provider composition root must require this accounting boundary for all enabled providers. Existing callbacks compose with it; they must not be overwritten or duplicated. A provider without attributable accounting must be unavailable rather than silently becoming free. Native services and private runtimes use the same port at their real network boundary.

No model execution is allowed to use an anonymous or client-selected payer. An ordinary caller cannot change the payer by submitting ownerId, projectId or requestId.

## Payer resolution

- Personal workspace activity bills the authenticated user’s personal wallet.
- Organization activity bills that organization’s wallet; the initiating user is retained as attribution.
- Resolve organization/personal workspace kind and membership from persisted identity. Do not infer account kind from ID prefixes or from whether a wallet exists.
- Background jobs persist the initiating user, organization and payer when queued and revalidate that provenance when executed.
- Run, subtask, tool and private-runtime calls derive ownership from the persisted root execution and lease. Child/model arguments cannot choose another account.
- No fallback from an organization wallet to a user wallet, or the reverse, after an insufficient-credit decision.

## Precision and wallet invariants

Represent credit arithmetic internally in integer hundredths. Calculate token cost as `ceil(totalTokens / 10)` hundredths, using integer arithmetic. Examples: 1/10 tokens -> 0.01 credit; 11 -> 0.02; 1000 -> 1.00. Count provider-reported prompt/output/cache dimensions without double counting cache or reasoning subsets.

Migrate wallet balance, credit ledger amounts and balance snapshots to exact two-decimal SQL numeric values with explicit bounds. Keep payment money in integer fen and retain historical order snapshots and existing source deduplication. Parse PostgreSQL numerics deliberately; never concatenate numeric strings in recharge arithmetic. Package/grant quantities remain subject to their existing positive-integer rules; consumption amounts support hundredths.

Ledger adds `consume` with direction -1 and a model-request source. Keep actor, payer, request, provider, model, feature/call purpose, actual tokens or native quantity, tariff version, debit, timestamp and resulting balance traceable. A unique settlement/request key prevents duplicate consumption. Replayed usage with different immutable facts must raise a mismatch, not acknowledge it as the same charge.

## Global preflight switch

Add one persisted platform setting, `creditPreflightEnabled`, editable only by platform operators and audited with operator/time/old/new values. Defaults to false on migration so deployment does not unexpectedly lock out existing users. Expose a nonsecret read model for UI behavior; browser state cannot override server enforcement.

When enabled, atomic wallet locking checks spendable balance = balance minus active holds. Reserve the verified maximum bound for the actual request; checking only `balance > 0` permits concurrent overspending. Insufficient credits prevent provider dispatch, return a structured error and a billing destination. Existing organization quota rules still apply.

When disabled, dispatch is allowed without a positive balance, but usage is still recorded and settled. The proposed policy is to allow a signed wallet balance to express the unpaid amount; UI displays it as an amount to replenish. This policy, and native pricing below, need the user’s design review before implementation. Enabling preflight subsequently rejects new calls against a nonpositive spendable balance.

The switch does not cancel requests already dispatched or erase holds/receipts. Provider-confirmed actual usage remains chargeable after a user cancellation or partial failure. A confirmed nondispatch/zero-usage result releases its hold without a debit. Unknown usage is pending reconciliation, never a fabricated zero or a fabricated token count. Outstanding uncertain holds are visible to operators and are not released solely by a timeout.

## Native model usage

Images and ASR can return images/pixels/seconds without tokens. Preserve that native quantity and use an explicitly configured, versioned credit tariff for that native unit. Do not label it as tokens. A monetary model price requires an explicit credit conversion and currency; never guess an exchange rate. An unpriced native model is unavailable with a configuration explanation, rather than charged at zero. Long-lived streams require bounded admission and incremental reservation renewal before exceeding an admitted bound.

## Entry coverage and delivery order

| Entry family | Required integration |
| --- | --- |
| Main chat, history summaries, script retries, agent/skill trials, subtask calls | Shared start/terminal observer; physical-attempt reservation and lease checks |
| Thread titles, follow-up suggestions, attachment extraction | Trusted non-run subject and unique per-request receipt |
| Guided/deep research, report chapters and streaming | Account for every planning/chapter/retry request; remove raw streaming-provider bypass |
| Interviews, digital interviews, report generation and recovery | Preserve initiating payer through workflows and background jobs |
| Knowledge extraction, goal linking, worthiness checks | Persist payer in queued work; each model operation separately metered |
| Canvas/templates, surveys, design variants/intake, feedback refinement, whiteboard processing, content skills | Pass trusted subject to the same public model gateway |
| Embeddings and reranking | Account for query and indexing batches; attribute indexing jobs to their source; avoid billing a nonmodel cosine calculation |
| Python/native SDK, web search/model tools, private runtime calls | Server-authorized per-dispatch grant and receipt; no direct unaccounted model egress |
| Image, ASR and local models | Mandatory accounting independent of old rollout flags; versioned native tariff when tokens are unavailable |
| Platform model test and operational model summaries | Attributable operator/organization payer; no implicit free administrative bypass |

Maintain an executable inventory of provider construction and actual network dispatches, not just `.complete()` calls. A source scan is a regression guard, not proof of runtime coverage. Each supported family needs a live signed/loopback-provider test that observes dispatch count, usage receipt, hold and consumption entry.

## User experience

- Insufficient-credit errors offer a direct personal/organization billing route while preserving unsent input, attachments and the current task. Do not clear or automatically resubmit the task after a payment.
- Organization members without purchasing rights see an actionable request to contact an administrator rather than a broken recharge action.
- Background execution produces a recoverable paused/credit-required state, not endless automatic retries.
- Wallet and usage pages show consumed credits, available/held balance and consumption history. Preserve existing recharge history and pagination.
- Async/SSE/WebSocket errors carry the same stable credit-required code as HTTP. The frontend must not depend on matching provider error strings.
- Platform settings display and audit the preflight switch, tariff and pending reconciliation; payment configuration stays separate.

## Acceptance and verification

1. With preflight on and zero credits, every enabled entry family results in zero provider dispatches and a recharge/admin action.
2. Fund a wallet, execute a known-usage call, and compare authoritative usage, rounded debit, wallet balance and consumption ledger. Repeat for personal and organization accounts.
3. Concurrent calls cannot reserve more than spendable balance. Parallel tenants cannot observe or modify each other’s wallet/receipts.
4. Replay start, terminal receipt, settlement and recovery work items; verify exactly one debit. Reject mismatched replays.
5. Streamed partial output, cancellation, timeout after dispatch, missing usage and process crash retain correct pending/charged state and recover without free or duplicate calls.
6. Disable preflight and repeat a call against an empty wallet: provider dispatch occurs and the full confirmed consumption is recorded under the reviewed unpaid-balance policy.
7. Toggle preflight during an active request; preserve its settlement, apply the new setting to subsequent dispatches.
8. Native-unit tests verify actual native receipt/tariff and missing-tariff rejection without invented tokens.
9. Run migrations twice; preserve existing paid/pending orders, recharge idempotence, fractional/negative wallet compatibility and old ledger snapshots.
10. Test UI input preservation, accessible recharge actions, organization purchase permissions and SSE/WS/background credit-required presentation.
11. Run affected API/Web typecheck/lint, contracts and migration guards, existing payment regressions, full credit concurrency/recovery integration, and per-entry browser/runtime acceptance. Submit PR and follow CI/review to green; do not claim deployment from CI alone.

## Review boundary

This change adds a subsystem connecting model execution to financial ledger state. The written design must be reviewed before implementation. The two policy choices are: how to account for insufficient balance when preflight is off, and whether native-only usage is charged with an explicit native credit tariff. The recommended choices are stated above and the user has been asked to confirm them together. Existing token conversion and idempotent reservation/settlement requirements are already authorized and are not being reopened.
