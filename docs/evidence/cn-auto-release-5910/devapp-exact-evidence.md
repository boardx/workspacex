# Exact-source Devapp acceptance for CN preparation

Status: implementation and local verification only. No workflow has been dispatched,
no privileged copy installed, and no Devapp private-key presence or live acceptance
is established by this document.

The existing normal develop deployment workflow is unchanged. The CN preparation
cloud job calls:

```
node .harness/scripts/vm/devapp-exact-evidence.mjs request
```

Inputs are `GH_TOKEN`, `GITHUB_REPOSITORY=boardx/workspacex`, `RELEASE_SHA` (40 hex),
`EVIDENCE_ATTEMPT=gha-<CN-run>-<CN-attempt>`, and optionally
`CANDIDATE_REF=refs/heads/main-cn` (the default). The helper verifies the ref's
actual SHA and dispatches `devapp-exact-source.yml` at that candidate ref. Its
inputs are `expected_source_sha`, `evidence_attempt`, and a unique
`evidence_request_id`. It waits for real terminal success and re-reads the exact
run attempt. Outputs are `devapp_run_id`, `devapp_run_attempt`, and
`evidence_request_id`. A queued or failed child is not acceptance.

The source workflow has one cloud `deploy` job holding the existing
`workspacex-devapp-deploy` mutex through deployment, browser acceptance, signing,
and final artifact upload. It requires the actual candidate SHA's latest main push integration and backend runs, all five existing integration
checks and six backend gate families (including every test shard) to have
succeeded. The installed root module independently reuses the same CI gate
before mutation and signing; a pending candidate fails closed. No trusted-main SHA substitutes for
candidate CI. Independent executor jobs and the existing real-model browser
workflow use the single self-hosted runner without occupying it while waiting.

The terminal source run publishes artifact `devapp-signed-evidence`, containing
only `devapp-evidence.bin`. Root derives `raw.coordination.parentRequestId` from
the independently verified parent's display title. CN admission must bind this,
`parentId`, `parentAttempt`, CN `attempt`, source and browser `runAttempt` to the
request outputs before staging. Final UTF-8 signed JSON, including a newline,
is limited to 16,777,216 bytes in producers and the protected evidence reader;
PEM inputs have a separate 64 KiB bound.

## Existing privileged entry, fixed modes

No new sudo rule or installed-file table entry is required. After separate
review and installation of the existing trusted copies, the entry supports:

```
/usr/local/bin/workspacex-deploy --devapp-candidate <source> <parent-run> <parent-attempt> <CN-attempt>
/usr/local/bin/workspacex-deploy --devapp-evidence <source> <CN-attempt> <browser-run>
```

Each receives one bounded GitHub token on stdin, never argv or a file. The
installed runtime identity module clears inherited environment before its fixed
GitHub reads. The candidate mode invokes the original normal deployment
implementation, retaining its stages. All normal writers, billing configuration,
and signing share a protected host lock. A trusted supervisor passes the same
open file description to its actual deployment child. Therefore cancellation of
the cloud coordinator does not let another writer enter before that child exits.
Root checks live parent run/attempt/source, current main-cn and containment in
main after acquiring the lock, before publishing a marker and before runtime
attestation. Signing checks the same parent, terminal browser attempt, artifact
bytes and actual current runtime. Automatic signing uses an asynchronous supervisor
that joins its detached worker group and deletes its exact private evidence
directory on TERM/INT/HUP, timeout or output overflow, before emitting anything.
Cloud child cancellation/join is best effort;
it does not establish cleanup after an uncatchable SIGKILL.

Required existing paths remain unverified on the live host:
`/etc/workspacex-devapp/evidence-signing.pem`, the runtime-evidence JSON and its
protected receipt. Missing paths fail closed; no key is generated or copied.
Fixed executables `/usr/bin/node`, `/usr/bin/flock`, `/usr/bin/unzip` and Python
must also exist. GitHub CLI is selected only from `/usr/bin/gh` or
`/usr/local/bin/gh` after root-only-write file/parent/realpath validation, never
from the runner PATH. The ordinary trusted-copy drift check remains mandatory before
invoking either executor mode.

## Verification

- `node --test .harness/scripts/vm/devapp-exact-evidence.selftest.mjs`: 29 passed,
  including stale source, failed dispatch, failed terminal, changed attempts,
  parent/browser mismatch, owned cancellation and the real-size envelope bound.
  GitHub replies and signing keys here are fixtures.
- Five affected Vitest suites: 39 passed; the Linux CI root integration entry is
  explicitly skipped on macOS, not counted as live-host evidence.
- Existing billing mode regression suite: 5 passed.
- Actual disposable Linux root Docker fixture used the extracted host-lock
  function and real child processes: passed. Killing the coordinator left the
  child holding the same lock, and the competing writer entered only after the
  child completed. The container was `--rm`, network disabled, repository mounted
  read-only; this is not a production deployment or runtime acceptance test.
- Three workflow YAML documents parse; deployment shell passes `bash -n`.

Local transcripts: `/tmp/devapp-exact-evidence-selftest.log`,
`/tmp/devapp-exact-evidence-vitest.log`,
`/tmp/devapp-exact-evidence-existing-modes.log`, and
`/tmp/devapp-exact-evidence-host-lock.log`.
