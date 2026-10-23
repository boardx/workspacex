# Runtime credit audit — 2026-10-23

These two implementation reviews cover the repository's model transport compositions. They are source and isolated test evidence, not a claim of production deployment or real merchant/provider acceptance. The earlier platform-usage dispatch inventory remains a bounded historical inventory; its counts are not a whole-system coverage denominator.

## Round 1: ownership and every concrete dispatch family

| Transport | Enforced boundary | Evidence |
| --- | --- | --- |
| Configured chat, streaming, tool rounds, titles, follow-up, interviews, guided research and other injected ModelCallPort consumers | `infrastructure/billing/credit-model-gateway.ts`: persisted root/child requester or authenticated/server-worker subject; byte-bound text input plus enforced output ceiling; physical request identity | Gateway unit tests, usage suite, real HTTP + PostgreSQL test |
| Python deep-agent, subagents and auxiliary model calls | `model_request_accounting.py`: sync/async HTTP transports always require ownership, durable spool, API admission acknowledgement before vendor HTTP; legacy rollout switches cannot disable it | Actual OpenAI/LangChain SDK and LangGraph accounting tests |
| Embeddings and rerank | API private clients always forward validated accounting subject; Python HTTP transports account each SDK batch/attempt; private API start/admit/terminal paths settle credits | Retrieval forwarding, SDK batch and private runtime tests; KG operation ownership tested separately |
| Local Ollama | Mandatory kernel accounting injection, checked local membership, explicit 4096 output limit and text-input bound before `/api/generate` | Local transport/accounting tests |
| Bailian and OpenAI images | Run-owned native admission persists hold/start before submit; native fallback tariff and reported Token facts retained; GPT image Token-bound requirement is independent of optional product quotas | Image transport/admission tests and financial ledger tests |
| Realtime/file/tool ASR | Mandatory accounting context and run/capture/session ownership; native tariff hold and PCM duration ceiling; legacy ASR metric mirror cannot create a second consumption receipt | ASR transport/accounting tests |
| Attachment VLM | `bailian-vision-extractor.ts`: uploader/server subject, mandatory meter before native DashScope HTTP, actual provider usage after response, unknown usage retained as unknown | 13 real loopback HTTP tests and real HTTP + PostgreSQL VLM debit test |
| Platform model tests | Existing operator/persisted test authority and request start flow uses the same financial usage writer and durable meter | Platform accounting suites, independently reviewed by parent |
| External opaque Open Deep Research | Adapter and gateway explicitly refuse with `credit_accounting_unavailable` before creating a remote graph thread. No guessed usage or fallback provider | ON/OFF zero-outbound refusal tests |

Review found and repaired the VLM transport bypass, missing non-run auxiliary start schema, optional retrieval forwarding, and optional native/local composition accounting. Trusted background subject propagation is reviewed and tested in the owning worker suites.

## Round 2: failures, retries and duplicate accounting

- The token usage repository remains the sole Token receipt writer. Credit reserve/start and credit settlement/Token receipt each share one tenant transaction.
- Private runtime admission checks durable receipt capacity with `prepareStart` before acknowledging permission to dispatch. A full/unavailable spool prevents acknowledgement; the test observes no dispatch and no durable start SQL.
- For transaction-scoped private/native admission, dispatch happens only after the outer tenant transaction resolves and the API acknowledgement is delivered. Merely resolving a nested scoped method does not trigger provider HTTP.
- Existing run observers retain ownership of their terminal receipt; the gateway does not emit a second usage fact. Bailian's real native admission advertises request accounting so execute-run does not create a fallback receipt after image delivery.
- Identical Token receipt replay is reconciled by the existing database trigger. The real HTTP/PostgreSQL test checks one provider request, one receipt, one consumption transaction, and an unchanged balance after terminal replay.
- Accounting write failures no longer trigger a paid model retry. Durable receipts are replayed independently of model execution. Unknown vendor usage preserves its hold; transport silence is not reported zero usage.
- GPT image reported Token usage is not dropped when its native image quantity is absent. Reported Tokens take precedence for credit settlement; native units are fallback. Strict preflight requires an audited Token ceiling for Token-billed image models; an image quantity alone is not a Token bound.

## Executed evidence

- `vitest.usage-unit.config.ts`: 70 files / 662 tests passed (`/tmp/credit-runtime-usage-tests10.log`; before later additive VLM/knowledge test changes).
- `vitest.credit-runtime.config.ts`: 24 tests passed, including 13 VLM loopback tests, 8 gateway tests and 3 structured private failure tests (`/tmp/credit-private-final.log`).
- `tests/billing/credit-model-pg.integration.test.ts`: 3 real HTTP/PostgreSQL tests passed under reserved database/port isolation (`/tmp/credit-model-pg-rollback.log`). A repeated pre-dispatch observer rejection also proves zero HTTP and zero remaining held credits. Both chat and VLM demonstrate zero-credit ON rejection before HTTP, funded 11 Tokens → 0.02 credit debit, and idempotent receipt replay.
- Python model/retrieval accounting: 92 tests passed (`/tmp/credit-python-tests5.log`; additional knowledge-index coverage belongs to the KG worker's later run).
- API TypeScript check passed after runtime/VLM/image changes (`/tmp/credit-runtime-typecheck4.log`, `/tmp/credit-image-typecheck.log`, `/tmp/credit-vlm-typecheck.log`). Parent runs aggregate final validation.

The private runtime maps only the exact serialized `CreditRuntimeUsageError` class and stable accounting code to `CREDIT_REQUIRED` / `CREDIT_ACCOUNTING_UNAVAILABLE` in run polling and error SSE frames. Arbitrary provider messages and user content cannot assert these codes.

## Explicit operating limits

`KERNEL_VISION_MAX_INPUT_TOKENS` must be an audited context bound for the configured VLM model. `KERNEL_IMAGE_MAX_BILLABLE_TOKENS` must bound the configured GPT image request. Missing bounds are not guessed: strict preflight refuses affected dispatches. Native fallback tariffs must be configured. ASR transport-queued PCM is an estimate; without authoritative vendor billed duration, its receipt remains pending with a hold and is not presented as settled native consumption. The external opaque research service remains unavailable until its own physical provider calls implement the private receipt protocol.
