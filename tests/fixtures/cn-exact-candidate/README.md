# Exact f0eb artifact lane: first executable slice

`preflight.py` consumes already downloaded **wrapper ZIPs**, not unpacked action
outputs. It makes no network request and cannot build or load an image. Input is
an independently selected SHA-pinned JSON manifest. It validates all seven
wrapper/original ZIP/hash chains and the original candidate metadata/fragments,
then uses the existing historical archive validator to verify every tar/config/
layer byte. Historical validation is explicitly not publication authorization.

Input selection schema:

```
kind: isolated-f0eb-preserved-selection-v1
sourceRevision: f0eb9d07398a66fdd5646a9e6b855fa1b940e571
controlRevision: exact harness checkout SHA
preservationRunId: actual completed preservation run ID
artifacts: { agent, api, postgres, sandbox, web, plan, set }
```

Each artifact value has only `artifactId`, `wrapperBytes`, `wrapperSha256`,
`file` (exact `<service>.zip`). IDs/hashes must come from actual GitHub preservation
artifact metadata, not placeholders. The manifest hash is supplied separately.
The authenticated metadata acquisition/handoff remains outside this offline
consumer. Output preserves wrapper ZIP, original ZIP and per-service original
metadata plus the verified tar bundle; failures leave the private output for
inspection and cannot restart into that directory.

On the GitHub Linux amd64 job, with pre-existing private input/output-parent dirs:

```
python3 -I -B tests/fixtures/cn-exact-candidate/preflight.py \
  --selection "$SELECTION" --selection-sha "$SELECTION_SHA" \
  --input-dir "$PRIVATE_INPUT" --output "$PRIVATE_NEW_OUTPUT"
python3 -I -B tests/fixtures/cn-exact-candidate/load.py \
  --root "$PRIVATE_NEW_OUTPUT" --preflight-sha "$ACTUAL_PREFLIGHT_RAW_SHA"
```

`load.py` is a separate explicit operation. It requires the same GitHub run and
checkout, an idle fixed local Docker socket (no containers), revalidates the
bundle, saves an exclusive durable claim before loads, rejects existing candidate
tags, and verifies loaded identities. For Docker containerd-store IDs it exports
by immutable ID and reuses the original config/layer verifier. No pull/build/tag/
push/create/start occurs. A failed load leaves an unknown claim and exact loaded
images for the outer disposable-job owner; no automatic retry or global prune.

The workflow must supply a bounded outer cgroup/process supervisor and total
budget covering archive hashing/extraction as well as Docker calls. Local tests
validate protocol rejection and resource decisions; they do not prove a GitHub
artifact, Docker load or six-business result. No such live operation has run yet.

The next slice is original-image startup and six browser journeys. Existing T22
launches current-source Next/API and mocks deep-agent/skill boundaries; its
launcher cannot be reused unchanged. This slice does not claim that integration.
Preflight observes actual MemTotal: 7 GiB never admits the original service caps.
Loading bytes may proceed on that host without claiming that seven services fit.
