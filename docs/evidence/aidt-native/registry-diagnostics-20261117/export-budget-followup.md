# Bounded BuildKit export follow-up

Application source stays frozen at `27b305e607281e54b4cf905269e30e26a35bee9e`. The preceding transport fix merged through PR #6690 as develop `162e48a860d38783b26af627f65a9ea0db7bead0` after six required queue checks succeeded.

## Actual complete-build attempt

[Run 44010515894, attempt 1](https://github.com/boardx/workspacex/actions/runs/44010515894) ended in failure at 2026-11-17 04:10:37 UTC. Control source was `3c53d1a4685eb666b59281f486e1ee82bd9b2067`, application source was the frozen SHA above, target DevApp, AIDT enabled, build-only. Tag: `44010515894-90000000000000000001`.

- Postgres, API, Sandbox and Web succeeded. Their four downloaded artifact ZIP hashes matched GitHub metadata, with identical application source and release tag.
- Web's combined build/export took 2280.034 seconds and succeeded. Its two public module flags were both 1.
- Agent's combined build/export hit `BUILD_TIMEOUT_AGENT` after 2400.025 seconds. The retained BuildKit tail showed layer `33b46e678431` continuing from 124.53 MB to 200.88/213.41 MB. The final retained progress was approximately 94.1%, with exporter elapsed 2374.9 seconds.
- No authentication, TLS or HTTP error was visible in that retained tail. This establishes an upload in progress at the stage deadline, not the unique underlying network cause or a guaranteed future completion time.
- The full manifest and deployment jobs were skipped. This partial image set must not be deployed or combined with another attempt.

The decoded Agent job log was retained privately outside Git: 41,741 bytes, SHA256 `0a1eb091520be8c5c3d170e722129b48ccac9214cbf633a0d55805c89c2b8063`. Raw logs and signed upload URLs are not copied into this evidence file.

## Narrow change and boundaries

Allow the existing single BuildKit build/export command 3120 seconds (52 minutes), instead of 2400. The existing GitHub job remains capped at 60 minutes. The nominal remaining 480 seconds is shared by setup, existing readback, artifacts and cleanup; it is not an independently enforced readback deadline or a guarantee that the whole job finishes within 52 minutes. The combined command does not separately enforce the old pure-compilation 40-minute cap.

There is still one export, no daemon-push fallback or additional upload retry, and all source/tag/platform/config/manifest identity gates remain. A timeout must leave no producer receipt and must not start readback. Existing registry pull retry behavior is unchanged.

[PR #6684](https://github.com/boardx/workspacex/pull/6684) by another author proposed a 52-minute shared build/push budget before the transport changed. Its branch and PR are preserved. This follow-up references that budget rationale for the current combined exporter; it does not copy or restore the retired daemon-push implementation, close the other PR, or claim its old patch applies to current develop.

## Local verification

`python3 -B -m unittest discover -s tests -p 'test_registry*.py' -v`: **66 tests passed**. The updated exporter tests check the actual timeout argument, one export, retained identity checks, and no receipt, pull or fallback after a simulated export timeout. These are local subprocess simulations, not a successful real upload, deployment, browser or classroom acceptance claim.

Next: an explicitly dispatched new complete five-service build from one attempt, exact artifact verification, then the existing DevApp schema/recovery release route and browser checks. No host permissions, SQL, production configuration or model settings are changed by this patch.
