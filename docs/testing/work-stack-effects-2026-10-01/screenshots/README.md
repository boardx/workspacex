# Local browser screenshots

Captured 2026-10-01 using installed headless Chromium against actual Next/React routes at http://localhost:3199/platform-admin/agent, production source head faee3f6384b45906a09b7d8a917a7052886ee630.

The browser intercepts API requests with synthetic organization/admin identity, empty Agent catalog, one Product Manager offer, and a deliberate offer HTTP 503 for retry-state capture. No real login credentials or user conversation data are used. Each screenshot labels this boundary. No import POST is performed; these are local UI evidence, not devapp, real-model, PDF execution or realtime-audio acceptance.

- 01-admin-entry.png: official digital human entry in admin.
- 02-product-manager-discovery.png: pending Product Manager and explicit enable action.
- 03-load-failure-retry.png: honest load failure and retry action.

The initial capture setup required correcting synthetic list shapes and CORS headers. Final browser run completed all three captures.
