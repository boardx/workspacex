# Model-backed guided research (#2775)

The normal `/research?session=…` workspace reads a durable session runtime. Brief, directions, outline, research planning and report generation all call the configured server model port. The legacy checkpoint generation endpoints also use that model port rather than deterministic templates.

## Configuration

- `KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER` and `KERNEL_GUIDED_RESEARCH_MODEL_ID` optionally override the general `KERNEL_MODEL_PROVIDER` and `KERNEL_MODEL_ID`.
- The model port uses the existing server model credentials and base URL configuration.
- `TAVILY_API_KEY` enables the real search adapter. It is required for actual search execution; missing credentials produce an explicit error.
- `KERNEL_GUIDED_SEARCH_URL` defaults to `https://api.tavily.com/search`. Override only for an explicitly trusted compatible gateway or the isolated loopback test provider. Search credentials are sent to this configured destination.
- Credentials belong in local/deployment secrets, never in tracked files.

## Persistence and concurrency

Apply migration `20260905120000_guided_research_runtime.sql`. The runtime row belongs to the existing research session and tenant. Both owner and explicit collaborator authorization are rechecked inside short transactions before each external operation and each persisted write. No database transaction spans a model/search call.

Commands bind session, node, request ID and expected version. The store atomically reserves the next version, records the request fingerprint and fences writes by version and active request. Repeating a finished request returns the current persisted snapshot without replaying its effects. A changed payload with the same request ID is rejected. A running command prevents another writer; progress renews its ten-minute lease; after the lease expires, a new version can recover, and the old writer cannot overwrite it.

Existing checkpoint sessions import their saved directions and outline and keep an immutable original session snapshot. Older search/report checkpoints have no trustworthy source records, so the UI explains the migration and resumes at research for a real rerun, rather than displaying an invented completed report.

Messages, model attempts, proposals, drafts, tasks, retrieved content, source decisions and report are stored server-side. The UI polls while an operation is running and can recover after navigation or a disconnected request. Failed/interrupted searches retain successful results; retries skip succeeded tasks. Saving an earlier step retracts downstream availability and invalidates its generated outputs. Applying a proposal requires its original version and target node.

## Sources and reports

Search tasks are created from model-generated queries covering the confirmed outline. Source IDs are minted by the server, URLs/content come from the search provider, and sources start pending. The user explicitly retains or excludes sources. Reports must cover every enabled outline section and reference only retained source IDs. Links are resolved from those persisted records, not from URLs invented by the report model. The model receives bounded source excerpts and is asked to state evidence limitations; structural citation validation is not a guarantee of semantic correctness.

## Verification

- API integration: `node --import tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/research/guided-runtime-persistence.test.ts`
- UI: `pnpm --filter web exec vitest run tests/ui/guided-research-live.test.tsx tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx tests/ui/guided-research-home-live.test.tsx`
- Browser: `node --import tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test guided-research-runtime.spec.ts --config=playwright.fullstack-smoke.config.ts --project=seeded`

The automated provider fixtures are explicitly configured HTTP/test doubles. They verify the real application and persistence paths, but do not constitute a real DashScope/Tavily production smoke test. That test additionally requires configured credentials and authorization for the external requests.
