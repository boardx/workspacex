# Research report transfer reduction — issue #5499

User feedback: report command SSE retained 9,645,384 bytes, including 152 source objects copied again in the previous-report snapshot. This change is a transport fix; it does not change model calls, evidence validation, report generation or persisted source snapshots.

## Behavior

- New clients negotiate `compactSources` for refresh, progress and command streams. When every historical source exactly matches a complete current source, transport sends ordered `previousSourceIds` instead of copying the historical bodies. Whole-source comparison includes content, document/hash and all metadata. Different historical content remains independent and complete.
- Patch references require either a matching complete baseline source fingerprint or complete sources in that same patch. Metadata-only updates invalidate source fingerprints. Client restoration happens after merging and clones historical objects before strict runtime validation. Missing/duplicate references fail explicitly.
- Legacy clients keep complete response shapes. Refresh remains authoritative, and compact refresh reconstructs the same canonical runtime. Transport fields never enter research execution or persisted state.
- SSE negotiates Brotli (quality 6/window 24), gzip or identity. Every compressed frame flushes immediately, including keepalives and terminal/error events. Backpressure preserves large frames and their terminal tail; disconnect/queue overflow closes only the observer. A five-second terminal drain bound applies after execution, not to research execution.

## Sample HTTP replay

The user's local pasted SSE was replayed through the actual Node HTTP stream writer. The private input was not copied into this repository. `replay-metrics.json` contains only byte counts and checks.

| Transport | Bytes | Reduction against pasted SSE |
| --- | ---: | ---: |
| Original | 9,645,384 | — |
| Compact decoded / identity | 5,010,555 | 48.05% |
| Compact Brotli | 1,269,253 | 86.84% |
| Compact gzip | 1,652,812 | 82.86% |

All encoded responses decode byte-for-byte to the compact SSE. All 152 historical objects reconstruct to their original full values and ordering. Native Fetch automatically decodes Brotli. These are local HTTP payload measurements, excluding headers/chunk framing, not devapp deployment, proxy/CDN or browser measurements. They do not establish faster model execution or successful report quality.

## Verification

- Pure API research suite: 27 files / 601 tests PASS. Focused HTTP tests: 18 PASS; negotiation/q=0, first-frame delivery before execution finishes, Unicode, multi-MB high-entropy frames and terminal tail, slow destination drain, disconnect and queue limits.
- API/controller tests: legacy and negotiated GET, visibility gate before runtime read (mocked unit proof, not native auth/RLS acceptance), whole-source equality/difference, complete-baseline requirement, ordered references and canonical SSE fingerprint memory.
- Web tests: 8 files / 63 tests PASS, including compact refresh, full historical divergence, invalid reference rejection, metadata/terminal merge, historical independence, single-language history UI and report recovery paths.
- API/web/contracts type checks; API and web lint; independent exact-SHA review and PR CI tracked on the PR.

Private local logs: `/private/tmp/research-5499-{red,http,focused,pure,web,web-focused,type,web-type,contracts-type,lint,web-lint}.log`. Replay runner: `/private/tmp/research-5499-replay.mts`. Owned HTTP servers in tests/replay are stopped in finally blocks. No paid models or persistent database were used.
