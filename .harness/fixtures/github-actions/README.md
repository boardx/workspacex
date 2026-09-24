# Trusted GitHub Action manifests

These files are byte-for-byte `action.yml` snapshots fetched from the immutable commits recorded in
`.harness/config/trusted-workflow-action-audits.json`. The offline control-plane gate verifies each
snapshot digest, action kind, complete composite `uses` graph, immutable nested refs, and nested
`runs.using` runtime.

To independently compare the vendored bytes with GitHub's exact-commit source, run:

```bash
node .harness/scripts/verify-workflow-action-audit-upstreams.mjs
```

Refreshing an audit requires changing the workflow pin, catalog provenance, and vendored manifests
in one reviewed commit. Never derive trust from a moving major tag or from a 40-character shape alone.
