# Retained held candidate fixed queries

`held_candidate_queries.cjs` exports `readHeldCandidate(control,queryId,params,context)`.
It opens no client and imports inertly. `control` is the existing diagnostic
ControlSession with `.client.query`, `.identity`, `.binding`, `.identityBinding`,
`.toolRevision`, `.mode=diagnostic`, and idle transaction state. The existing socket/
provider identity function is reused before, during and after the transaction.

Only query IDs `held-candidate-schema`, `held-candidate-permissions`, and
`held-candidate-seed` exist; params must be exactly `{expectedReadbackSha256}`.
Context is compiled source: `{identity,connection,binding,expectedReadbackRef,
readPrivate,verifyQualifiedExpected}`. Binding has the five existing collection
fields identity/toolRevision/host/semantic epoch/held generation. The private reader
returns actual Buffer bytes for the exact approved expected-readback path; their
hash is verified on every read. The qualified-source verifier must prove the current
isolated acceptance artifact and APP template/table/provider/role/column closure;
it cannot be a flag deserialized from that artifact. All five fields must match.

Source-closed target IDs are api/agent/memory `-schema`, `-permissions`,
`api-system-agent`, `agent-init-schema`, and `memory-init-schema`. No caller can
select tables, columns, SQL or alternate schemas. Schema targets have fixed scope
public (API/Agent) or workspacex_memory (memory). Role names and API org/stable-name/
provider values are bounded parameters from the qualified source artifact.

Catalog queries read fixed source table sets, column types, RLS and policies, and
require every fixed relation to exist. Permission queries reuse the existing
control helper's ROLE_SQL single SELECT and hash the selected role metadata plus
actual diagnostic privilege projection. API seed checks join real agents,
agent_versions and capability_listings and require a single exact org/template,
published matching version/provider and agent listing. It cannot pass missing or
aliased agents. Qualification must independently prove all three source template
stable names/providers per approved org, not accept a partial template set.

Agent/memory `-init-schema` facts are explicitly initialization schema projections,
including fixed tables and extensions. They are not mislabeled empty seed rows.
Each target count/digest must match the source-qualified expected artifact; unknown
IDs, missing targets/probes, arbitrary fields or default empty sets reject.
Unsupported nondefault memory schema requires a reviewed source implementation;
it is never interpolated from caller input.

Every invoked probe uses BEGIN TRANSACTION READ ONLY, checks SHOW transaction_read_only,
sets transaction-local statement timeout, and finally ROLLBACK even if BEGIN's reply
is lost. Failed SELECT, changed actual session, incomplete catalog, count/digest drift,
changed expected bytes or failed ROLLBACK yields no proof. Response contains only the
existing safe consumer shape identity/connection/probe/readOnlyTransaction/
rollbackComplete/verified/evidenceSha256; raw agent data is hashed in memory, not
returned. Date facts canonicalize to ISO before hashing.

The ROLE_SQL dependency loads on invocation so the existing control helper can import
this module without a require cycle. Both modules must be in the reviewed installed
closure; this source does not install them or grant permissions.

Local evidence: `node --test .harness/scripts/vm/test_held_candidate_queries.cjs`
passes five tests with all nine database/probe combinations, wrong targets/parameters,
missing qualification, stale epoch/generation, actual seed join corruption, raw hash
and expected count/digest mismatch, missing required relations, SELECT/BEGIN/reply/
ROLLBACK errors, actual session and expected-byte drift. These are mocked existing
clients, not a production compatibility or qualified replay claim.

Remaining source integration: root must supply protected context from the approved
plan/actual hold/current qualified epoch, prove complete APP template/provider closure,
wire the existing ControlSession handler and include both modules in the exact tool
manifest. No host command, SQL session, actual migration or production activation was
run during development. Missing qualified context keeps held readback blocked.
