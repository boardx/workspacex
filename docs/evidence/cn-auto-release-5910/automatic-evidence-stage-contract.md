# Automatic CN signed Devapp evidence staging

The user explicitly requested removal of release governance validation. This stage
therefore consumes no OIDC, broker response, governance signing key or governance
facts. It does not create replacement or synthetic governance evidence.

The existing `workspacex-cn-deploy` entrypoint accepts exactly
`--auto-stage-evidence <40hex-source> <gha-run-attempt>`. It opens the existing
canonical release lock without replacing/truncating it, acquires it on FD9, and
executes only the installed root helper. No sudo entrypoint is added. The helper
checks root Linux identity, FD9 inode/owner/mode/single-link and actual
`/proc/self/fdinfo/9` WRITE FLOCK, then applies existing maintenance admission.

Stdin is one JSON header line (at most18 KiB), then exactly `devappBytes` original
signed UTF8 bytes and EOF. The original file, including any newline, is limited
to16 MiB. Truncation, trailing bytes and unknown fields (including removed OIDC
or governance inputs) are rejected. The exact header fields are:

```text
schemaVersion:1
sourceSha, attemptId
devappParentRunId, devappParentRunAttempt, evidenceRequestId
devappBytes
```

Devapp signature verification uses the existing pinned public key and validators.
Its CN attempt/source must match the header. Signed coordination parent run ID,
parent run attempt and parent request UUID must match the separately awaited
workflow outputs; browser run ID/attempt must match actual signed acceptance.
Original signed expiry is checked again immediately before persistence.

Only two root600, single-link, create-once files are published inside the root700
exact candidate directory under the canonical lock: `devapp-evidence.bin`
(unchanged bytes) and `devapp-acceptance.json` (including their original hash).
Private temporary files are fsynced and linked without overwrite. Failed
publication removes only files created by this invocation. Existing final files
or symlink directories require reconciliation. SIGTERM, SIGINT and SIGHUP abort
input and prevent uncommitted persistence. The two names are published separately
under the shared lock, not by a single cross-file atomic rename. SIGKILL/power
failure can leave incomplete evidence, which completeness validation must reject.

Auto-only Devapp work runs on an independent cloud job with a95-minute budget.
CN build requires both source bundle and Devapp jobs to succeed; manual requires
both to be skipped. The exact successful parent's signed artifact is downloaded,
restricted to the runner account, and removed even on failure/cancellation.
Root staging occurs after `--prepare`, before promotion verification/tag freezing.
No `id-token: write` permission or token request is needed.

Installation adds only `cn-auto-evidence-stage.mjs` to the existing root helper
directory. Its existing `cn-controlled-evidence.mjs` validator and pinned
`/etc/workspacex-cn/devapp-evidence-public.pem` remain required. Broker helpers and
governance keys are not dependencies of this path.

Validation after removing governance:

- `node --test .harness/scripts/vm/cn-auto-evidence-stage.selftest.mjs`:11/11,
  actual Ed25519 and private filesystem checks, exact two-file output, unknown
  input rejection, context mismatches, expiry and cancellation counterexamples.
- Focused Vitest stage/workflow/bootstrap suites: results recorded in
  `/tmp/cn-stage-devapp-only-wiring.log`.
- The unchanged FD9 checker was previously exercised in a disposable root Linux
  container: actual unlocked/held/replaced-inode checks passed, container removed,
  read-only source mount, no network. Log `/tmp/cn-auto-evidence-lock-linux.log`.

Tests use controlled signatures and do not claim actual Devapp or production
acceptance. No production actions were executed by this worker.
