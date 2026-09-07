# Main integration: d30ac48e8

Peer PR #2890 is merged into main. This integration reuses its final workbench, replay, identity, UI and test repairs, retaining standard-capability changes. Because the peer was squash-merged, conflicts were reconciled against the previously integrated peer b952314f0; the original three inputs are retained locally under /private/tmp/wx-main-peer-merge.

Configured-model streaming keeps both peer message identities and call-scoped cancellation. Journal relay retains tool step envelopes plus the peer persisted-plan ordering. Parent-run authorization keeps ExecutionAuthorityContext and the locked callback needed by scheduling. Migration replay uses the peer guarded state-preserving definitions.

Verification: API typecheck exit 0; 13 API files / 58 tests passed in one isolated database stack and were cleaned. Exact MCP/subtask boundary tests passed. This verifies the integrated working tree, which also contains pending CI TLS/canvas/scheduler fixes and the notification worker increment; it is not evidence that every newly developed increment is in this merge commit. Full GitHub CI and broader live-model acceptance remain outstanding.
