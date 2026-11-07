# Original-spec attempt 1: not a pass

Command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.chat-read.config.ts --project=chat-read e2e/copilotkit-v2-persona-archived.spec.ts --workers=1 --retries=0`

Registered file declares three tests. Output reached `Running 3 tests using 1 worker`; no case verdict was emitted. Actual wrapper exit1; execution2m27, cleanup2m49, total5m16. Docker Desktop daemon query returned unable to start, and wrapper reported `cleanup failed: docker compose down -v exited 1`. Main is handling the shared daemon/disk-full incident. No assertion, browser-pass, real-model quality or cleanup-container-zero claim.

Own scope: `wsx-2e9db9d56316e29a1575`; all eleven reserved ports and twelve verified provider/Next process IDs were checked dynamically absent after targeted cleanup. Container state remains unverified while the daemon is unavailable. Private full log/trace stay in /tmp or ignored test-results. No secrets are included here.
