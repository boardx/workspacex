# A+B backend reliability follow-up

Scope: shared stage drafts and member text channels only. C interview recording remains a separate, unapproved design. No service contract, permission model, configuration, credentials or production database was changed by this review.

## Findings (three maximum)

1. **Fixed: A migration could not be force-replayed.** `20261115092900_aidt_stage_revisions.sql` had bare `CREATE TABLE` and `CREATE POLICY`. The repository's `apps/api/scripts/migrate-check.ts` explicitly ignores the migration ledger for replay (`force:true`); the original file therefore failed with PostgreSQL `42P07`, not merely a hypothetical lint concern. The narrow fix adds `IF NOT EXISTS` and drops/recreates the same tenant policy. Columns, constraints, data and grant values are unchanged.
2. **A prior successful run is not a live deployment.** The previous `ab-delivery/final-candidate-cleanup.json` records a cleaned stack and no listeners. Old `/tmp/aidt-live-health.json` is a static receipt. During this follow-up QA started a new owned stack from a screenshot baseline; its PostgreSQL was verified healthy and used below. This does not itself prove that current root-source API/Web processes, a user-accessible preview or an actual supplier are ready. Fresh API marker/source binding and current HTTP reads are needed for each runtime.
3. **Real AI remains unverified in the inspected configuration.** The canonical fullstack config explicitly injects local deterministic Chat, ASR, deep-agent and sandbox fixtures. The initial follow-up shell had no `KERNEL_MODEL_PROVIDER/BASE_URL/API_KEY`, selected-model IDs or ASR provider variables, and this worktree had no `.env.local`. This is evidence about the selected environment, not a claim that the organization has never configured a provider elsewhere. A real supplier, matching published Agent/model pin, native tool services, organization policy/credit and successful actual calls are still separate acceptance requirements. AIDT Skill installation/mounting configures none of those by itself.

## Real PostgreSQL negative control and replay

Used the QA-owned disposable local stack `wsx-6030c13119bec123c735`, database `wsx_6030c13119bec123c735`. No production access. The probe used container-local peer access; no password, participant content or project IDs were printed.

Original HEAD migration SQL was copied before editing and run in its own transaction:

```bash
docker --host=unix:///var/run/docker.sock exec -i wsx-6030c13119bec123c735-postgres-1 \
  psql -U postgres -d wsx_6030c13119bec123c735 -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -q \
  < /tmp/aidt-stage-replay-negative.sql
```

**Exit 3, `ERROR: 42P07`**. The connection closed and its failed transaction rolled back. Original negative-control input contained `BEGIN`, the unchanged HEAD SQL and `ROLLBACK`; it did not change seeded business data. See [before output](migration-replay-before.txt).

The repaired SQL was then executed twice in one transaction using [the SQL probe](migration-replay-probe.sql):

```bash
docker --host=unix:///var/run/docker.sock exec -i wsx-6030c13119bec123c735-postgres-1 \
  psql -U postgres -d wsx_6030c13119bec123c735 -v ON_ERROR_STOP=1 -q -t -A \
  < docs/evidence/aidt-native/module-isolation/backend-reliability/migration-replay-probe.sql
```

**Exit 0.** Before replay, the transaction inserted one explicitly synthetic stage row using an existing project foreign key; it did not edit projects, tags, members or existing revisions. This populated fixture was never visible to another connection and was rolled back. The probe held a short table lock, verified both replays and exited before QA continued.

| Snapshot | Rows | Data digest | Schema/constraints/policies/grants/RLS digest |
| --- | ---: | --- | --- |
| Before first replay (with synthetic row) | 1 | `1c2f8bd76a187bd2372a5f2a509a94c4` | `ad3957f396eec6fce3f072b4634ab117` |
| After first repaired replay | 1 | same | same |
| After second repaired replay | 1 | same | same |
| After ROLLBACK | 0 (original) | `d41d8cd98f00b204e9800998ecf8427e` (original) | same |

`rollbackRestoredOriginal=true`. All probe sessions and locks were released; no test container was created or taken down by this worker. See [after output](migration-replay-after.txt).

This verifies replay of the **A migration** against the current existing schema, including preservation of populated data and access controls. It is not a claim that the entire historical migration set was rebuilt/replayed in this follow-up. The normal versioned migration path remains unchanged. B's migration already uses replay-safe table/index/policy forms; its runtime grants and service contract were not modified.

## Permission, CAS and retry review

Read the current A/B controllers, services, repository transactions and migrations:

- A locks its project row, organization and actual general member before canonical authorization. CAS is checked and the immutable revision/operation receipt written under that same transaction. A repeated operation is scoped by org/project/actor and compares the normalized whole request; changed content fails rather than overwriting another revision.
- B rechecks canonical project read plus actual membership, takes project/org/member locks, then rechecks canonical roles and the existing content-write action. Every incremental read, topic read and idempotent retry uses the same gate. Removed members and nonmember organization managers cannot obtain content; archived/disabled/readonly contexts cannot post.
- B counter allocation, message insertion and idempotency receipt share one transaction and channel lock; a later commit cannot advance the cursor past an earlier uncommitted message. History/deltas are bounded by the captured counter. Topic summaries include changed roots even when replies arrive on old topics.
- Both migrations retain FORCE RLS, composite org/project integrity and the existing organization-freeze/project-archive policies. Direct project foreign keys allow the existing archive installer to discover these tables. A and B message rows remain append-only through their public APIs and grants.

No additional confirmed runtime bug was found in this source review. The prior real PG/HTTP/browser acceptance remains in `ab-delivery`; this review does not claim those scenarios were all rerun. A new root-source freeze should rerun the focused A+B suite after frontend iterations and include the fresh source/runtime marker.

## Read-only readiness suggestion

QA can record separate rows rather than one misleading “healthy” label:

1. API `/healthz`: fresh `deploymentMarker`, expected latest migration, forced RLS and runtime role not owner. This endpoint checks the kernel/database, not supplier reachability.
2. Authorized A+B GETs: stage list, channel list/topic reads and current write capability for the actual member; no new message or model dispatch is needed for this read check.
3. Authorized Skill/capability catalog: installed/enabled exact stage Skill, published usable Agent and its matching model pin. For an organization administrator, the existing `/organization/core-model/candidates` exposes `available/reason`; it is not a license to promote roles or select another model.
4. Real AI readiness: supplier configuration and verified deployment bindings, actual native service availability, organization model policy and credit, followed by an explicitly identified real-provider acceptance call. Label fixture routes as fixtures. Do not silently substitute another provider or turn off admission/accounting to get a green result.

`ConfiguredModelProvider` rejects missing provider/base/key and mismatched pins. `AI_QUOTA_RUNTIME_CONFIGURATION` requires trusted model-bound registrations; when quota wiring is enabled without them startup fails with `AI_RUNTIME_REQUIRED_CONFIGURATION_MISSING`. A key alone does not establish that readiness. No settings or credentials were changed here.
