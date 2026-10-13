# Fixed CN business observer: executable A6 adapter

The normal A5/A6 path is implemented locally; it has not been installed or run
against production. It uses fixed root-owned paths, the existing canonical six
browser journeys, and the original finalizer's exact-five status validator.
It never accepts a caller-supplied boundary or arbitrary command.

## Stages and authority

- Isolated browser validation emits `cn-isolated-business-acceptance-v1`; it
  cannot authorize production clear or substitute for A6.
- A4 `acceptance` is held, read-only exact-runtime health. The router uses the
  original finalize status template. It does not call this browser adapter.
- A5 requires the separately approved `cn-writer-resume-approval-v1`, tied to the
  exact release, binding, switch, held-health, hold generation, explicit user
  authorization and test-data scope. Its absence is a wait at A5, not an intent.
- A6 `observe <releaseSHA>` runs the canonical browser once, then checks a stable
  window of 30–300 seconds. Normal execution never extends the original deadline.
- `readback <releaseSHA>` does not log in or repeat a journey. It verifies the
  original private receipt, current runtime/clear and the three actual persisted
  run IDs, then returns the original business receipt bytes. This fits the entry
  executor's terminal/reconcile protocol without changing the action evidence.
  Read-only reconciliation may run after the original deadline; the original
  completed receipt must still be within its original execution window.

`preflight <releaseSHA>` checks execution capability before consume/hold. It
requires the actual runtime and preconfigured test identity, but does not require
an A5 approval that is deliberately supplied later. Missing configuration fails
closed. There is no permanent unconditional refusal in the normal A6 path.

## Fixed paths and exact closure

The once approval is `/etc/workspacex-cn/release-approvals/<releaseSHA>.json`.
Its `business` object has exactly:

```
{
  "runtimeProfileSha256": "<SHA256>",
  "planSha256": "<SHA256>",
  "testDataScopeSha256": "<SHA256>",
  "recoveryPlanSha256": "<SHA256 of baseline browser plan>",
  "recoveryTestDataScopeSha256": "<SHA256 of baseline test-data scope>",
  "stableWindowSeconds": 30
}
```

Its `codeFiles` must pin the observer/state/recovery Python files, both TS sources,
canonical `.harness/scripts/vm/cn-maintenance-browser.cjs`, the canonical browser
schema/boundary TS files, and original `finalize/runtime.py`. Files in the
installed versioned repository must be root-private regular files with safe
root-owned parents. No imported target script is loaded before checking its pin.

`/etc/workspacex-cn/business-runtime.json` is root-owned mode 0600, with exactly:

```
{
  "schemaVersion": 1,
  "toolRevision": "<40-hex installed control revision>",
  "nodeSha256": "<actual /usr/bin/node>",
  "pythonPath": "/usr/bin/python3.12",
  "pythonSha256": "<actual versioned Python binary>",
  "dockerSha256": "<actual /usr/bin/docker>",
  "holdHelperSha256": "<actual installed canonical hold helper>",
  "chromiumRoot": "/opt/workspacex-cn/release-tools/<revision>/chromium",
  "chromiumPath": "/opt/workspacex-cn/release-tools/<revision>/chromium/chrome",
  "chromiumSha256": "<actual Linux Chrome binary>",
  "chromiumFilesSha256": {"chrome": "<SHA256>", "...every other file...": "<SHA256>"},
  "runtimeRoot": "/opt/workspacex-cn/release-tools/<revision>/business",
  "entryRelative": "scripts/cn-release-business-entry.mjs",
  "playwrightRelative": "node_modules/playwright",
  "filesSha256": {"...every runtime file...": "<SHA256>"},
  "sourcePins": {"...the five browser source files...": "<SHA256>"}
}
```

Both directory manifests are exact whole-tree inventories: unlisted/missing
files, symlinks, writable parents, unexpected owners or changed hashes reject.
The JS entry bundles its TS/schema/Zod dependencies. All dynamically imported
Playwright and playwright-core files, their package metadata and the canonical
CJS runner are included. Linux OS/kernel/shared-library and Python standard
library remain the separately administered host trust base; this package is not
an operating-system attestation.

Build without downloading or installing dependencies:

```
node scripts/build-cn-business-runtime.cjs /unique/output/business /existing/playwright/package
```

This produces a complete runtime and an adjacent `.manifest.json`, with exact
source/file SHA256s, and refuses an existing output directory. A local build
produced 176 files and passed `node --check`. The profile must use the Linux
runtime's actual binary and complete Chrome distribution hashes, not the Mac's.
No image or browser package was downloaded for this work.

The root-private plan and test scope are fixed to:

```
/etc/workspacex-cn/maintenance-activation/<source>/<attempt>/browser-plan.json
/etc/workspacex-cn/maintenance-activation/<source>/<attempt>/test-data-scope.json
/etc/workspacex-cn/maintenance-activation/<source>/<attempt>/audio.wav
```

The plan uses the existing canonical exact plan schema. Scope is
`cn-release-test-data-scope-v1` and pins the exact release identity, CN public
origin, email, agent/thread/feedback IDs, GitHub issue number, skill version,
SHA256s of both prompts, and audio. Credentials exist only in the target's
preconfigured private plan; no account/password/token is created by this tool.
Missing scope or runtime capability blocks preflight before mutation.

## Actual readback and restart behavior

Python holds the canonical `runtime/release.lock` while Node requests fresh
state through a bounded stdin/stdout protocol. State reads the exact remote
binding and independently generated switch binding, switch intent/result,
actual clear action/receipt/terminal hashes, its request/action pins, A5 pointer
and original approval, actual held-health evidence, materialization provenance,
and the executed original clear command. It reads the real hold helper before
and after Docker inspect, checks configuration/env hashes, and calls the pinned
original `validate_status` function. No supplied JSON can replace these reads.

The action also requires membership in the executor's enforced Linux cgroup.
It creates `/var/lib/workspacex-cn/business-evidence/<attempt>` exclusively and
fsyncs its intent before launching. No automatic retry/overwrite exists. The
browser session token is transferred only on the private child pipe and saved
mode 0600 inside that directory; it is never part of stdout receipts, argv,
provider logs or documents. The result records actual three run IDs. Readback
uses that session only for bounded GETs to those three runs.

A timeout or partial failure leaves the intent/session in place and yields no
success receipt. Process-group cleanup is not proof that provider operations
ended. The business receipt explicitly has `externalWritesTerminal:false`;
only independent readback can establish the terminal verifier result. Missing
original receipt after a failure remains unknown and needs separately reviewed
reconciliation; it cannot trigger another business run.

## Installation proposal and remaining work

An approved installation must create the root-private runtime/profile, exact
source closure, complete Linux Chromium distribution, pinned Node/Python/Docker
and hold helper, preconfigured test plan/scope/WAV, and the root-owned 0700
`/var/lib/workspacex-cn/business-evidence` directory. The continuation entry's
cgroup and canonical lock must already exist. This is a proposal only: no target
installation, credential provisioning, login or production write occurred.

The recovery lane uses `baseline-health <releaseSHA> <freshRecoverySHA>` for
held read-only health, then a separate `cn-recovery-writer-resume-approval-v1`
and the fixed recovery-writer helper for clearing the retained hold.
`rollback <releaseSHA> <freshRecoverySHA>` executes the canonical six journeys
against the exact old five-image inventory after that real clear. Its distinct
`recovery-<freshRecoverySHA>` evidence directory is created exclusively before
browser execution. `rollback-readback` only reads the original three run IDs
and current baseline state; it does not repeat login or write journeys.

Both old-version browser plan and test-data scope are preconfigured at the
baseline revision's fixed maintenance-activation path; the scope pins
`runtimeRevision`. The fresh recovery window is independent of the expired
release window, whose original strings remain unchanged in all receipts.
Runtime rollback does not restore database contents or deleted logs;
`dataRestored` remains false. A missing actual clear receipt, mismatched old
image/configuration, changed container inventory, missing scoped identity or
expired action authorization blocks execution. Recovery readback may inspect
completed work after authorization expiry but cannot authorize another action.

The recovery writer integration is under final independent review. No target
installation or production rollback/old-version business acceptance is claimed.

## Reproducible local checks and their scope

```
python3 -B tests/test_cn_release_business_observer.py
python3 -B tests/test_cn_release_business_state.py
python3 -B tests/test_cn_release_business_recovery.py
node --import tsx --test tests/cn-release-business-runner.test.ts
node --import tsx --test tests/cn-release-business-browser.integration.ts
node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target es2022 \
  --module esnext --moduleResolution bundler \
  scripts/cn-release-business-runner.ts scripts/cn-release-business-entry.ts
```

The browser integration test requires actual installed Playwright/Chromium and
loopback listen permission; missing capability is a failure, never a skipped
pass. `CN_TEST_PLAYWRIGHT` and `CN_TEST_CHROMIUM` select installed test binaries
only in that test. It runs real Chromium against a temporary TLS service,
including login/navigation, three actual POST/SSE responses, six persisted-run
GETs, microphone capture, feedback, tool trace and PDF bytes. It uses an isolated
service fixture, not cloud ASR/LLM providers or production test data. TLS trust
and the `/etc` audio path are adapted only inside the test.

Observed locally: 27 Python tests (10 observer, 6 normal state, 11 recovery),
13 Node contract tests, strict TS checks and a 176-file offline runtime build
passed. Actual Chromium candidate and expired-original-window baseline
fixtures both passed in 2.45 seconds total. Independent review reran both
browser scenarios successfully. The original 4.77-second evidence is preserved
separately. These are isolated local results, not a production deployment,
real provider acceptance or a 30-minute full-cloud E2E success.
