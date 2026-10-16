# Restored-case supplementary acceptance

Issue #5764. From the repository root, after committing/fixing the tested source:

```sh
node apps/web/scripts/run-board-remaining-acceptance.mjs
```

This entry creates one fresh local isolation scope through the existing harness;
do not wrap it in another isolation invocation. It does not select an existing
database, alter the native producer, or replace the complete fullstack suite.
The fixed worker command is admitted by the existing heavy Playwright lock.
The fullstack config supplies its normal build, services, migrations and seeds,
including the dedicated real public-share fixture. No credential overrides are
required or printed. Run the complete fullstack/native suites separately.

`board-remaining-registry.mjs` is the sole supplementary case inventory. The
Playwright config derives matching files/titles and the verdict derives expected
counts from it. Collection detects renamed/missing cases; execution must produce
each exact file/title once, in the registered project, with one passed attempt,
expected status `passed`, and no skip/fixme/fail annotation. Retrying, flaky,
absent, skipped, duplicate and global-error outcomes all fail. Collection alone
is labelled `COLLECTED_NOT_EXECUTED` and cannot pass acceptance.

The entry prints a summary path under a new private temporary directory. It
retains actual command arrays, exits/signals, tested HEAD, raw JSON and private
logs. A tracked dirty tree or changing HEAD fails. Final PASS additionally
requires exit 0 from the outer isolation wrapper, including its standard cleanup;
`WORKSPACEX_KEEP_TEST_STACK=1` is rejected. First failure classification is kept;
cleanup/isolation failure is recorded separately. Do not publish the private raw
reports/logs, which can contain application payloads and trace diagnostics.
Visual screenshot assertions are not human visual signoff or hardware acceptance.

Root-owned verification for the new summary contract:

```sh
node --test apps/web/scripts/board-remaining-registry.test.mjs
```

The developer who added this entry did not execute tests or browser acceptance.
