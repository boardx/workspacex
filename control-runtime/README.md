# Canonical control runtime draft

This is a minimal control dependency graph, separate from candidate application
dependencies. `tsx` and `zod` have exact versions; `package-lock.json` pins the
transitive packages and registry integrity. Production test tools are excluded.

Prepare a portable review candidate, using the reviewed control checkout and an
official, verified Node 22.20.0 Linux x64 executable:

```bash
npm ci --prefix control-runtime --ignore-scripts --no-audit --no-fund
python3 scripts/prepare-canonical-control.py \
  --control /path/to/reviewed-control-checkout \
  --runtime control-runtime \
  --node /path/to/verified-node-22.20.0/bin/node \
  --output canonical-closure \
  --review-config canonical-control.review.json
```

The generator emits a `draft-unapproved` provenance record. Review the source
hashes, locked dependency graph, Node bytes, configuration and configuration
SHA-256 independently. A generated hash is evidence for review, not approval.

The workflow installs this same minimal lock and runs the preparation script
without `--review-config`. It requires a previously reviewed configuration in
the control checkout and a separately configured expected SHA-256. It never
replaces either with the newly generated closure's own declaration. Missing or
different bytes fail closed before canonical execution.

Both configuration paths are relative to the configuration location, so the
same config bytes work in different runner workspace roots. Linux amd64 is the
current supported workflow target. Real GitHub Actions and ACR access have not
been exercised by this draft.
