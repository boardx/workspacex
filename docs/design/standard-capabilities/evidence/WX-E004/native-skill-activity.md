# Native Skill facts, peer v1 integration

Only `metadata_discovered` and `body_read` are emitted. They do not claim execution started or succeeded. The peer owns main-run persistence, attempt identity and UI projection.

`_BoundSkillsMiddleware` calls the official SkillsMiddleware loader, validates the existing private session/package cache binding, then reports actual returned metadata. Matching checkpoint metadata replays the same facts; unknown name/path bindings refuse. Package integrity downloads and metadata scanning never emit body_read.

`NativeSkillActivity` uses the official middleware tool-call hooks and a ContextVar scoped to the real read_file invocation. HttpSessionSandbox notifies only after an upstream read succeeded and capture cleanup completed, with nonempty content and an actual line request. Ordinary files, failed reads, zero-line reads and operations outside the read_file context emit nothing. Sync and async calls preserve context; no global mutable callback or model-supplied identity is used.

Body fact IDs include the real tool-call ID. The peer strict v1 body_read schema has no public toolCallId field, so none is invented. SHA-256 identity material is a compact JSON array of stage, skill ID, stable name, version ID, package digest, readPath/null and toolCallId/null. Run identity is supplied solely by the peer writer, not the fact. No attempt/session/random ID is included, allowing checkpoint replay to deduplicate. Different stages and real tool calls have distinct IDs.

Package digest is SHA-256 of UTF-8 compact JSON `[path,digest]` pairs sorted by Unicode code point. The shared browser-safe `skill-package-manifest.ts` defines canonicalization without node crypto. The generator exports the strict peer SkillActivityStream JSON Schema, algorithm descriptor and TS-computed golden hash; Python consumes those artifacts. The golden deliberately includes U+E000 and emoji, whose order differs between JavaScript default UTF-16 sorting and Python code-point sorting, plus Chinese paths.

Reproduce generation: `pnpm exec tsx packages/contracts/scripts/generate-skill-activity-schema.ts`.

Verification: real uniquely owned sandbox `wx-skill-activity-test`; `test_native_skill_activity.py`, `test_native_graph.py`, `test_native_image_read.py`, `test_skill_packages.py`: 52 passed. Includes sync/async actual metadata/body custom events, same-checkpoint stable replay, body writer failure propagating exactly once, metadata identity refusal, no context/error/zero-line non-events, and existing package/image/native graph checks. Shared contract freshness/golden tests: 2 passed. Raw output retained alongside this file.

Writer/validation exceptions become SkillActivityError, excluded from the existing official tool retry predicate. This proves local writer failure propagates; custom stream is not a synchronous database acknowledgment, and journal/checkpoint writes are not claimed atomic. The peer provider must await its callback and reject missing/failing persistence; graph invocation outside a consuming stream alone is not durable evidence.

Owned sandbox compose stack and volume are removed after verification. No external model, production deployment, main-run event writer or API provider change is part of this module.
