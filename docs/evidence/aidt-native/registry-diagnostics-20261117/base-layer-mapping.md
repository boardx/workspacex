# AIDT uploader: public base-layer mapping and verified historical manifest

Read-only discovery completed. Full machine values: [aidt-base-layer-and-baseline-manifest.json](/tmp/aidt-base-layer-and-baseline-manifest.json).

Historical successful release43758477392 attempt1 artifact14178763675 was downloaded through the GitHub MCP. Raw ZIP SHA256 **fda4f0959be14205347c5a2ecc39b866f8eff74297987b115bed7bc73d74b069** exactly matches GitHub artifact metadata. release.json records sourcee78e00b8d2d5021d9caed2041fc58f550f2e6250, tag43758477392-1 and complete five-service digests. These establish historical identity, not current running host state. Its image digests and IDs are in the JSON; no archive signed URL or credentials are retained.

The unresolved current progress ID1d7b9dd8778e is now mapped beyond inference. Anonymous DockerHub metadata from each exact pinned image was read with normal TLS/proxy; index, selected linux/amd64 manifest and config raw bytes were checked against their SHA256 descriptors. No layer body or personal credentials were used; anonymous public pull tokens stayed in memory and were not printed.

| Upstream base | Config rootfs diff_id prefix | Matched upstream compressed blob | Compressed bytes |
|---|---|---|---:|
| node22-slim | 1d7b9dd8778e | dd051e1b8c92ff101fa3071ab97ea4924885942f15644e01c3dc095764e863e3 | 28,247,982 |
| pgvector/pgvector:pg16 | 1d7b9dd8778e | same upstream blob | 28,247,982 |
| python3.11-slim | dd57f90311a2 | 37fb86c2a767b88d500c6872195f88078f64765fe0d2f9cc375cc2efbd4c0a41 | 29,856,132 |

Both are first layers. This supports a32MiB incompressible canary as a comparable transfer-size control. It does not prove a size-only cause: the Postgres upstream also contains an118,047,771-byte compressed layer whose corresponding progress ID657c7b8eaed7 already existed in the failed ACR push, while the smaller first layer stayed Waiting.

Caution: those compressed digests/sizes are the **upstream DockerHub descriptor mapping**, not a direct ACR blob read. A target may use recompressed bytes; verify ACR metadata before claiming its exact digest or testing a descriptor as authoritative. The diff_id match is independently proved from source config.

The current new script snapshot was reviewed without editing. Its bounded32MiB payload, 180s push/pull, explicit separate scratch tag, whitelisted progress and manifest descriptors, safe output receipt and nohost scope are appropriate. One mixed-error classification counterexample was sent to root/owner: inspect_manifest currently maps any nonzero raw output containing “manifest unknown” to missing even if it also contains unauthorized/denied/TLS/timeout. Auth/transport negatives should take precedence, with a test, to keep unknown errors from authorizing a new probe tag write. This is a snapshot finding; owner may have since fixed it.

No code mutation, new dispatch, app build, registry write, host/config/permission operation or additional budget PR was performed here. Root owns the current diagnostic branch/probe execution.
