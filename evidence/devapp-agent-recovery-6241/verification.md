# Verification receipt

Product commit: 54785d9b2. Base: cf77b91708d5a5326ea9824fc68aa4949928a473.

- Root checkout ./init.sh fast baseline: exit 0 before changes.
- API credit-runtime lane: 33 passed, including 7 real HTTP/parser boundary cases. Previous no-op parser run: 3 failures (legal oversized input wrongly rejected), 4 passed.
- Web recovery/parent/copy tests: 67 passed, 4 existing skips. Before UI fix new busy/progress test failed.
- API and Web typecheck, API and Web lint: exit 0 (logs retained).
- Production recovery component + production Tailwind/CSS in Chromium: 8 checks passed, mocked retry callback. Screenshots retained. Not API/PG/model E2E.
- Full CK-P4 API/Postgres browser E2E enhanced but local execution blocked: Docker info unresponsive. Must be validated by CI; not counted as passed.
- Online repair is not yet active: code requires review, green PR, merge, then manual image-release deployment. Do not label the live incident resolved before release and live verification.

## Payload size and simplification

Default API HTTP limit is 102400 bytes; the admission schema accepts 2000000 UTF-16 characters of exact serialized provider request. New route envelope is schemaMax*6+65536 bytes, to cover worst-case JSON escaping and bounded metadata; this is an envelope ceiling, not a target context length or new model token budget.

API recent history already uses 20-message / 12000-character limits. Native skills middleware loads pinned skill metadata once, rather than injecting all skill bodies each turn. Harness already includes history summarization (60000-token trigger) and filesystem tool-result eviction (default 8000-token threshold). Tool schema exposure is separately pruned by the existing tool-budget middleware. Those bounds operate at different stages; none makes a 100KiB HTTP limit correct for the complete provider envelope.

No evidence collected yet proves one of these sections is disproportionately redundant in the two original payloads. Do not fabricate per-section size measurements or arbitrarily cut context to 100KiB. Any later context optimization must happen before provider/admission serialization and preserve exact-body identity and budget measurement; reducing only the admission copy would invalidate policy/accounting.
