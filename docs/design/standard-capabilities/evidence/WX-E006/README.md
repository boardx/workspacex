# WX-E006 / T020 native output collector component

Collector lives in application/agent-run/collect-native-outputs.ts and consumes a
factory-bound `BoundSessionFiles.read(path): Promise<unknown>` plus the existing
ObjectStore. Only explicit /workspace paths are accepted, using the existing portable
relative-path schema (including its 512-character relative-path bound). Duplicate
basenames are refused. Session response schema, canonical Base64, path echo and byte
length are checked before publishing references. Limits reuse sandbox maxFiles and
maxFileBytes; maxRequestBytes is a conservative aggregate transport budget, not a new
product artifact quota. SHA256 derives from actual binary bytes; run identity is also
hashed into the object-key prefix. Existing-object retries require matching readback.

MIME mapping was extracted from run-skill-script.ts to output-file-mime.ts and both
callers reuse it. Unknown extensions stay application/octet-stream. Returned references
are exactly existing RunOutputFile, with no new event/artifact model. Every put is
followed by real ObjectStore.get verification. Failure rejects the entire batch; earlier
puts can leave unreferenced immutable objects, but no attachments or ready events are
created by this component. Object storage garbage collection remains the existing owner.

## Verification

Tests were written first. Initial invocation failed because the collector module did
not exist (`collector-red.txt`), then final implementation and boundary tests passed:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/collect-native-outputs.test.ts tests/agent-runtime/deep-agent-produces-files.test.ts
```

Exit 0, 26/26 tests, two files. Raw output: `collector-tests.txt`. Uses real FsObjectStore
in an isolated temporary directory, with actual binary disk writes and readback. Fault
ports assert malformed/padded Base64, mismatched size/path, extra directory metadata,
read errors, disk failure and corrupt readback refuse references. Counts, individual
8 MiB and aggregate budget overflow are exercised. Existing script file pipeline tests
remain green. Wrapper cleaned its own stack; diff check passes.

This is not production native output delivery: session reads here are test producers,
not the still-pending UDS adapter. Actual native factory/session binding, final output
selection, thread authorization and peer lifecycle/ready integration remain required.
No production selector or main-run state was modified. These tests do not claim UI or
cross-user attachment-download E2E evidence.
