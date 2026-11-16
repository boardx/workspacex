# S2 supplementary failure: offline diagnostic boundaries

This review made no network probes, model calls, stack changes, Design writes or financial mutations.
It examined existing source and allowlisted projections of the private logs supplied by the stack owner.
No key, endpoint, model configuration, human prompt or raw request body was exported.

## Actual observations

- Run `40539aa6-2732-4661-9665-913013af806d` terminated with `MODEL_CALL_FAILED`.
- The existing API log's fixed safe detail is `deep agent run ended with status "error"`.
- The existing Python log exposes `APIConnectionError`; its available projection contains no traceback
  cause chain, HTTP status or errno. A log line containing `tool_choice` does not establish a parameter error.
- A1's [failed accounting audit](../../completion-20261116/a1/s2-supplement-20261116/native-failed-accounting.json)
  records two request starts and two failed usage receipts. Each has `tokens_total=0` with prompt and
  completion counts null; the total-source field needs the separate owner query. This is insufficient
  evidence of known zero usage. The two credit requests are pending, with reservations 3412 and 5217
  hundredths and no settlement time. Their reservation total is 8629 hundredths. No refund or settlement
  was performed by this review.
- These facts do not identify a supplier rejection, bad `tool_choice`, model incapability, or a specific
  proxy/network defect. A request-start receipt is not independently proof that a supplier received it.

## Where the generic code is produced

| Layer | Existing source / diagnostic | What can share `MODEL_CALL_FAILED` |
| --- | --- | --- |
| Model execution | `application/agent-run/execute-run.ts` catch around 1200 | Empty completion; provider error; native session/output/persistence/configuration problems; unexpected execution exceptions |
| Outer executor | `execute-run.ts` catch around 1371 | Executor defects; these are persisted with bounded `failure_reason=executor_defect` |
| Native adapter | `infrastructure/agent-run/deep-agent-model-provider.ts` | Native thread/run submission/read HTTP errors, transport failures, timeout, remote error status, missing completion, skill/progress delivery failure |
| Native Python graph | `deep_agent_service/self_hosted_runtime.py` `_execute` | For ordinary exceptions, stores the exception class name; the original cause chain/status is not retained here |
| Provider HTTP / accounting transport | `model_request_accounting.py` | Admission callback failure, durable receipt capability failures, underlying HTTP transport failure, or incomplete/failed stream; inspect typed error evidence rather than infer from the outer run code |

The existing `classifyModelCallFailureReason` produces bounded reasons, persisted by `failRun` and
returned in the run projection. Its `provider_rejected` rule matches a native **run** ending in error;
that label alone does not establish rejection by the external supplier. The native `readRunStatus`
retains a dedicated typed credit failure when present, but otherwise reduces an error run to its status.

The private API log can hold more detail than the public run projection. Here the existing
`structuredErrorLog` selects the supplied detail string, and `ConsoleLogger.error` emits that as
`detail.raw` with a trace ID. The model-call log's original code/reason/run-ID fields are not separate
fields in that console record. This is an existing generic diagnostics limitation, not a proven AIDT
context-binding defect; it was reported without modifying the shared logging/provider/financial modules.

## Available safe next evidence

The stack owner can project the exact run's `failure_reason`, each usage receipt's `total_source`, and
any actually retained allowlisted exception cause class / HTTP status. Unknown values must remain unknown.
The native model builder sets SDK retries to zero when admission is enabled; two request starts alone
therefore do not identify an automatic retry. Actual per-request timing and call-purpose facts are needed.
The available logs do not provide enough information for a stronger cause attribution. The paid chain
has stopped, and both supplementary Design tasks remain unused.
