# HTML attachment delivery (later than core beta)

The real S013 run exposed missing text/html artifact support: browser interaction worked, but bundle.html could not be published. The shared artifact schema now admits text/html and the existing extension/MIME map accepts .html only with matching filename/MIME and strict UTF-8 bytes. No HTML sanitizer, renderer or publication engine was introduced. Scripts remain file content; accepting a downloadable HTML file is not permission to execute it on the application's origin.

Existing agent-artifact content already forces attachment and nosniff. Native writeback also creates a chat attachment, whose old default was inline: the content route now forces attachment for text/html, with nosniff. Other existing previews retain their behavior (real PNG inline and explicit download tests passed).

Red: wrapper 48271 produced 1 expected HTML schema failure and 5 existing passes. Green: wrapper 5249, 13/13 tests, 10 seconds, peak 5 connections, automatic cleanup. Exact command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-output-staging.test.ts tests/agent-runtime/native-output-staging-real-db.test.ts tests/chat/attachment-content-route.test.ts`.

The real PostgreSQL staging/writeback test reads the same HTML bytes through both production HTTP controllers. Both return text/html, Content-Disposition attachment, X-Content-Type-Options nosniff, and exact original bytes; a same-organization private-thread intruder receives 404 on both routes. Binary/non-UTF8/mismatched MIME/title rejections remain tested.

standard-web 1.1.2 changes only web-artifact to 1.0.2; 1.1.1 and older starter files remain immutable. The method no longer permits absence of traffic or avoidance of old refs to stand in for rejection tests, nor file existence for visual verification. Pack loader/bytes/digests/tamper checks passed. This is not a completed S013 real-model quality gate; that rerun and untested mandatory scenarios remain separate.

Additional final checks: API `tsc --noEmit` exited 0; shared native artifact schema tests passed; Python real local-HTTP native artifact publish tests passed 5/5 after running with the required local socket permission (the restricted attempt could not bind its test server). New packDigest: `a74e3482c471accc14cb8a53e3d2070eef40aab42a6741703aa26fcf2464b845`.

Actual model reruns of the revised package still exhausted the unchanged 25-call budget before publication; see G-SKILL-methods/browser-bounded-budget. No completed S013 claim is made.
