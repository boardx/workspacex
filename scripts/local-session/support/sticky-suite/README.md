# Sticky Full Native Acceptance

Test-only delivery for issue #5194, referencing #4222. This is separate from the
existing `board-sticky-acceptance.mjs` partial M0 runner. No historical screenshots
or reports are presented as a fresh execution.

## Scope

The CLI retains the eighteen S01-S18 executors and both actual hardware receipt
gates. Native OS IME and Apple Trackpad evidence cannot be replaced by synthetic
composition or wheel events. The committed historical acceptance document is
hash-pinned and its case IDs are compared with the executor inventory. Its behavior
rows are byte-identical to the previous private reference; its historical warning
is preserved, not treated as a current approval or passing status.

The functional scope derives from the existing user-confirmed Sticky requirements
and the Round 06 plan in `docs/design/board-ux-next-10-iterations.md`. This suite
does not introduce new product behavior or wire schemas.

## Verification

Run focused source counterproofs after the normal repository bootstrap:

```bash
node --experimental-strip-types --test scripts/local-session/support/sticky-suite/*.test.mjs
```

Run the actual native suite only against an explicitly provisioned local runtime
and authorized owner, peer and viewer state files:

```bash
node --experimental-strip-types scripts/local-session/board-sticky-full-suite.mjs \
  --root /absolute/repository \
  --base http://127.0.0.1:3317 --api http://127.0.0.1:3320 \
  --manifest /absolute/runtime-manifest.json \
  --owner-state /absolute/owner-state.json \
  --peer-state /absolute/peer-state.json \
  --viewer-state /absolute/viewer-state.json \
  --ime-receipt /absolute/human-ime-receipt.json \
  --trackpad-receipt /absolute/human-trackpad-receipt.json \
  --out /absolute/fresh-private-evidence
```

This command does not provision or start services. The manifest and observed
runtime must match the full tracked source set from the sole
`board-runtime-source-files.mjs` selector, including that selector itself. The
historical Sticky import-closure utility is a subset diagnostic, not runtime
authority. Missing receipts, execution gaps,
unexpected browser transport failures, or source changes are failures, not skips.

## Resource Boundary

Every successfully created board is immediately registered and recorded privately
before metadata validation. Preserve-only cleanup checks the exact owner and title
by GET and closes each actor. It never sends archive PATCH or permanent DELETE.
Preservation does not stop subsequent cases, but the final `cleanupPending` report
forces `requiredSuiteComplete=false` and nonzero exit status. The retained boards
are not called permanently cleaned. Permanent deletion needs separate explicit
human authorization and is not implemented by this runner.

Focused tests prove source and counterproof contracts only. They do not establish
full native execution, real hardware use, browser convergence, or whole-suite PASS.

The public failure receipt contains only fixed phase/code fields. Raw page errors
and exception details exist solely in private 0600 files; those files must not be
uploaded as public artifacts or copied into issue/PR comments. Publish sanitized
counts, fixed codes and approved screenshot evidence instead.
