# Devapp failures (#6241)

2026-11-05, deployed develop cf77b91708d5a5326ea9824fc68aa4949928a473 (image release 41869512308).

User threads: thr-579c565b-184b-4fa5-879d-a23503e2c769 (PDF), thr-0704d532-d042-4954-9434-e7285ef7f502 (canvas/retry).

## Observed online, read-only through authenticated ECS Workbench

- Agent container alive; native graph exception chain: model_request_accounting.py:830 -> apost admission, line 450 -> RuntimeUsageError usage_receipt_delivery_unconfirmed -> SDK APIConnectionError -> run error.
- API logs contain PayloadTooLargeError from body-parser/raw-body. Historical terminal usage_ownership_denied also present; those terminal events are not treated as proof of the admission root cause.
- Callback is internal http://workspacex-api-host:3200.
- Size probe from live agent container, no internal key, nonexistent run so no billing/model execution: POST /internal/agent-runs/diagnostic-nonexistent/model-requests/admit with JSON padding. 1,000 chars -> 401; 110,000 and 250,000 chars -> 500. Large bodies fail before controller authentication. API's generic exception filter reports raw parser errors as 500.
- Contract serializedBody allows 2,000,000 UTF-16 characters, but main.ts did not register an admission parser before Nest's default 100 KiB parser. Reading skills/history expands the exact provider request carried by admission. Retrying unchanged long context hits the same limit.

## Change

Route-scoped parser registered before Nest defaults, envelope derived from existing schema character maximum * 6 (JSON worst-case escaping) + bounded ownership metadata. Existing schema, key authentication and ownership/policy checks retained; start, terminal and public routes keep default transport limits. Over-envelope parser errors become 413.

Failure recovery explains that step retry preserves completed progress; disables both recovery actions while submitting, displays 正在重试…. Provider failure text gives a concrete next action without claiming that the user's input or model caused the failure.

## Validation boundaries

HTTP tests are real local HTTP/parser/schema integration, with no model or database. Web tests render real components with mocked service ports. Browser evidence separately states fixture/fullstack coverage. No claim of live devapp recovery until reviewed code is merged and manually released.
