# CN fast-safe release lane

`prepare` and `activate` are separate operations. Preparation may take as long as
building and pulling the four images requires; it must not change public traffic.
Activation consumes only a complete, unexpired preparation receipt and has one
300-second wall-clock budget.

## Preparation input

Before running `workspacex-cn-deploy --prepare <SHA>`, place a root-owned `0600`
JSON document at `/etc/workspacex-cn/preparations/<SHA>.json`. It contains the exact
source SHA and release name, manifest hash, four immutable image digests, migration
risk and changed services, a verified RDS backup point, canonical-config assertions, shadow readiness/business
results, and any classified failures. Do not put secret values in this file.

The three durable configuration assertions mean the canonical deployment JSON has
non-empty `asrProfile`, `platformSuperuserEmails`, and `githubIssueProfile` references.
Both CopilotKit Nginx locations must report 3600-second read and send timeouts.
Every check is `passed` and carries its evidence SHA-256; `skipped` is invalid.
Destructive migrations use a separate maintenance lane and are invalid here.

A waiver is valid only for `stale-test` or `infrastructure` and contains an issue URL,
evidence SHA-256, owner, and expiry no later than the preparation expiry. `product` and
`unknown` failures always block. Re-run preparation after a waiver expires.

Preparation captures the live four-container image IDs, Compose file, and Nginx hash.
It binds that fingerprint into
`runtime/<SHA>/fast-safe-release.json`. Only after this succeeds may automation move
`main-cn` to the prepared SHA.

## Activation

The trusted entrypoint recomputes the live fingerprint and refuses a changed baseline.
It then rejects new CopilotKit POST requests, waits for all `queued`, `running`, and
`writeback_pending` Agent runs to drain, installs the prepared ingress, and runs the
canonical eight provision stages. A headless browser must log in through the public
origin and complete an authenticated same-origin API request.

Any failure after admission closes restores the captured Nginx and the exact four image
IDs using the captured Compose runtime. An unproved restore is a terminal red state and
requires operator inspection. Never remove the retained lock or mark the release passed.

The activation command is unchanged:

```sh
sudo /usr/local/bin/workspacex-cn-deploy <SHA>
```

The final record must include the prepared receipt hash, baseline hash, exact revision,
four digests, migration/backup evidence, drain counts, canonical 8/8 report, browser
smoke result, duration, and rollback result when applicable.

## Current release choice

Plan A is to prepare the newest `main` SHA only after all product gates are green, then
activate it through this lane. Plan B keeps the current CN baseline serving while a
failed product gate is fixed; it may reuse already verified unchanged service layers in
the build cache, but the final manifest still contains four images labelled with the
new exact source revision. Plan B never waives `product` or `unknown` failures.
