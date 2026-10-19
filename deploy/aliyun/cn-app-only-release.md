# CN app-only release: code path, not production acceptance

This opt-in path is only for an already provisioned `app.boardx.com.cn` deployment.
It changes the existing Compose file's **api and web image fields only**, under
the existing shared release lock. Agent, sandbox, sessions, DB, Redis, env files,
mounts, network, TLS and AppArmor remain unchanged. Compose uses explicit api/web
services with `--no-deps --no-build --pull never`; no orphan cleanup is requested.
API replacement can interrupt requests. This is not zero downtime.
Each check/switch/recovery reuses the existing bounded IMDSv2 ECS identity helper;
the instance, Shanghai region and public origin are fixed, with no insecure fallback.

## Boundaries and admission

`promote-cn-production.yml` defaults to `release_mode=standard`. Its existing
protected `cn-prepared-*` tag, normal environment approval, signed governance,
exact-source CI/Devapp evidence, main-cn CAS and uncertain-CAS handling remain.
`release_mode=app-only` consumes pre-staged, root-owned tooling and cached images;
it never checks out/clones/builds/installs on the production runner. The maintenance
lane and standard eight-stage provision remain separate. An app-only request is
explicitly rejected by the standard deploy/promotion branch.

Before the release window, the controlled preparation process must supply:

- The existing six-entry immutable manifest/seal and prepared receipt; api/web
  images must carry the candidate source label and digest. Agent/sandbox image
  references must resolve to the actual unchanged baseline image IDs. This mode
  does not assert that untouched services run the new source SHA.
- Actual baseline.json, baseline-nginx.conf and normalized effective runtime-config
  hash (only api/web image fields omitted). The live baseline and unchanged services
  are checked again. Other configuration fields are never rendered or replaced.
- A root-private `/etc/workspacex-cn/preparations/<SHA>.app-only.<attempt>.json`
  matching `appOnlyInputSchema`: exact source/baseline/attempt, baseline/config hashes,
  four passed evidence references for unchanged schema, mutation-free startup,
  backward read/write compatibility and unchanged environment/security, plus a
  fresh observation/expiry window no longer than one hour. Missing/unknown fails.
  `requestedAt` is the original recorded release request, not approval completion;
  expiry cannot exceed that request by 30 minutes. Activation leaves at least
  120 seconds for recovery and refuses an exhausted window. Never reset this clock
  to hide queue/build/approval delay; a new attempt is explicitly a new request.
  A SQL diff alone is insufficient. The existing effective API environment must
  already have `KERNEL_PLATFORM_SKILL_SELFHEAL=off`; the release never sets it.
  This flag alone does not prove startup mutation freedom: other startup hooks
  still require actual compatibility evidence.
- Existing signed source/Devapp/governance receipts. No workflow checkbox can
  manufacture these facts, and no TTL is extended.

The compatibility request's **original byte SHA256** is bound into the existing
prepared receipt's `checks.migrationAssessed.evidenceSha256`, so its contents are
covered by the frozen tag/admission request. The preparation-side binding adapter
is `cn-fast-safe-release bind-app-only <prepared-input> <app-request> <output>`.
It is root-only, retains all other existing gates, refuses non-api/web changes or
pending migrations, writes the canonical fast-safe-release.json exclusively, and
does not collect or invent evidence. **It is not a compatibility probe.**

## Once-only setup, excluded from routine release

Review and install the updated existing deploy/verifier entrypoints and the
root-owned 0755 `cn-app-only-guard.py` through the established installation process.
Stage a self-contained exact-source/dependency closure at
`/var/lib/workspacex-cn/releases/<SHA>` (root-private) and a root-owned, runner-readable
control snapshot at `/opt/workspacex-cn/app-only-tools/<SHA>`. The guard refuses
untrusted owners/modes, escaping symlinks, alternates, promisor objects or source
drift. No fallback fetch or package install occurs during promotion.
The existing baseline runtime's browser credentials and installed Chromium are reused.
No new account, sudo grant, runner permission or secret is created by this change.
Installation and production execution require their own applicable authorization;
this implementation does neither.

## Switch, recovery, and CAS

The existing root dispatcher exposes `--app-only-check`, `--app-only`,
`--app-only-rollback` and `--app-only-commit`, with the existing exact SHA/attempt
arguments. Check is read-only. Activate uses a 300-second action budget, verifies
local digests/source labels and the live baseline, records durable intent, changes
only api/web image fields with a file-byte CAS, starts those services and verifies
running image IDs, unchanged dependencies/config and the existing public browser smoke.
It never invokes canonical migrate/bootstrap/provision or prepare-host.

After a switch failure, the bounded 120-second recovery uses the captured old
api/web image IDs and the same Compose file, verifies the old running containers
and browser smoke, and records `rolled-back`. It does not restore a DB snapshot,
overwrite configuration drift or delete orphans. Unknown recovery records
`uncertain`. The root-private `app-only-inflight.json` blocks another release until
exact-attempt reconciliation. Successful activation also retains intent until the
existing strict remote main-cn CAS is confirmed. Commit re-verifies the actual
candidate runtime before clearing intent. A lost CAS response retains intent;
it does not blindly roll back possibly accepted production or repeat the switch.
Read-only checks may verify only the matching existing intent instead of rejecting
it as a new release. A fresh remote ref read selects CAS reconciliation without a
second switch; a different attempt is still rejected. Publication expiry blocks
new activation/CAS admission, not restoration of that intent's fixed old images.
Expired intent verification reports its closed publication window; it cannot
authorize a new CAS. Immediately before a new remote CAS, promotion rechecks that
window and bounds the network call by the remaining time. Readonly confirmation
of an already advanced ref is distinct from publishing after the deadline.
SIGTERM/SIGINT cancels the activation client; recovery starts only after that
action settles and uses a separate 120-second signal. It never inherits a permanently
aborted activation signal, gains new authority or disables the recovery deadline.

The browser smoke is the existing login plus authenticated notifications request.
It is **lightweight availability acceptance**, not full business acceptance; reports
always retain `fullBusinessAcceptance:false`. Reuse actual exact-candidate full
business evidence, keep its uncovered cases explicit, and do not mark A0-A6 complete
from isolated tests. Maintenance A2-A4 (current backup, restore, migration) are N/A
only after proven no-data-change classification; data/seed changes use maintenance.

## Thirty-minute budget and current blockers

Record request-to-ready, CI/build/staging durations and request-to-published separately;
also report the complete end-to-end calendar lead time. If artifacts are not ready
when release is requested, that build delay remains part of delivery time.
Routine warm budget: approval/queue 5m, admission 2m, pre-staging check 5m, switch plus
smoke 5m, observation 5m, CAS/record 1m, recovery reserve 7m = 30m. These are budgets,
not measured percentiles or a promise about human approval. Stop before switching
if readiness, fresh proofs, lock, baseline or budget is unavailable.

No production state or release success is established by this PR. Current real
baseline/compatibility/startup mutation evidence, reviewed tool installation, valid
candidate selection and an isolated/then explicitly authorized live rehearsal remain
uncompleted. The old fixed BC candidate has expired and is not silently rebuilt or
replaced. The last unprivileged diagnostic PermissionError neither proves nor
disproves the existing root deploy identity; no permission change is inferred.

After commit removes the inflight marker, the durable committed attempt remains
readable by same-attempt readiness reconciliation. Its exact source, attempt,
request, prepared receipt and manifest hashes must all match. This path only
re-verifies the actual candidate; it never reactivates, refreshes a deadline or
authorizes late publication. Committed state cannot authorize rollback. A fresh
attempt without that exact durable state still requires normal baseline/freshness
admission. A different inflight marker always takes precedence and blocks it.
