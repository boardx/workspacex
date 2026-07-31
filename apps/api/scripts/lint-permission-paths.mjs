#!/usr/bin/env node
/**
 * lint-permission-paths.mjs -- the structural half of R7 "permission travels along the
 * data path" (UC-0.3 R7 / R12 V10, coherence X-1).
 *
 * `permission-filter.ts` makes it impossible to DISCLOSE tenant content without a
 * decision: the payload is unreachable except through `disclose()`. What it cannot do is
 * stop someone reading the table directly and never wrapping the rows at all. That is the
 * bypass this script closes.
 *
 * ## The rule
 *
 * A file under `apps/api/src` that names a tenant-carrying table in SQL must
 *   (a) live under `src/infrastructure/`  -- data access is not a controller's job, and
 *   (b) import `application/security/permission-filter` -- i.e. hand back `Guarded<T>`.
 * Anything else is a read path that reaches tenant rows with no decision attached.
 *
 * ## The table list is derived, never written down
 *
 * Tenant tables come from parsing `apps/api/migrations/*.sql`: any CREATE TABLE whose body
 * declares `org_id`, plus whatever those columns REFERENCE (that is how `organizations` is
 * found). Same derivation as `kernel_tenant_table_audit()` in the database, for the same
 * reason: a hand-maintained list is missing exactly the table someone just added, and the
 * gate stays green while the newest table is the unguarded one.
 *
 * ## The allowlist, and why it is three files
 *
 * Enumerated here rather than inferred, and each entry states what makes it different --
 * an allowlist without reasons grows.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(API, "migrations");
const FILTER_MODULE = "application/security/permission-filter";

/**
 * Files permitted to read tenant tables without going through the filter.
 *
 * Every entry is a place where the filter CANNOT apply, not a place where it was
 * inconvenient. Keep it at three; a fourth needs an argument this shape:
 *
 * ⚠ **F32（迁移 0027，新增 `download_grants`）量过这张表，结论是不用改** ——
 *   rebase 到同时含 F49 / F117 / F81 的 main 之后实测
 *   `node scripts/lint-permission-paths.mjs` 报 `allowlisted=9`，F32 **没有**加第 10 条。
 *   `pg-download-grant-repository.ts` 读 `download_grants` / `artifacts` / `artifact_versions`，
 *   三张都是租户表，但它在 `infrastructure/` 下、且经 `guard()` 出门，本来就走的是正门。
 *
 *   这句话之所以写下来：**「量过、结论是不用改」和「根本没量」在 diff 里长得一模一样**，
 *   两者都是「这个文件没出现在改动列表里」。同一个仓的 `verify-rls.sh` ratchet 正是
 *   因为这种不可分辨静默失效过三次（F31 也为此在那边留过同样一句）。
 */
const ALLOWLIST = new Map([
  [
    "src/infrastructure/identity/pg-identity-repository.ts",
    "reads the memberships and bindings the decision is MADE from -- guarding it with the decision would be circular",
  ],
  [
    "src/interface/controllers/kernel-probe.controller.ts",
    "the RLS evidence surface (UC-0.6): it must read rls_probe with NO application-level filtering, because the whole point is proving the database layer alone isolates",
  ],
  [
    "src/infrastructure/db/migrator.ts",
    "schema/DDL machinery; its rls_probe row count feeds the migration idempotency digest, not a response",
  ],
  [
    "src/infrastructure/auth/pg-registration-repository.ts",
    "F19 registration: WRITE-ONLY against tenant tables. `Guarded<T>` protects DISCLOSURE -- it makes it impossible to hand tenant content to a requester without a decision. This path discloses nothing: at the moment it runs the organization does not exist yet and there is no requester to judge, because the caller is an anonymous visitor holding an invite code. Wrapping an INSERT in a permission decision would mean asking 'may this person read the row they are creating', which has no answer. ⚠ The exemption is valid ONLY while the file stays write-only, so it is not left as a claim: tests/auth/registration-repo-is-write-only.test.ts parses the file and fails if any statement naming a tenant table is not an INSERT. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/context-pack/pg-context-pack-store.ts",
    "F13 context_packs is a FROZEN AUDIT RECORD, and the decision `disclose()` would attach is the wrong one -- re-authorising a run's segments at replay time mints new permissionDecisionIds (so I-11's 'follow the id to the judgement that applied' lands on the wrong record) and lets a since-revoked permission SHRINK a pinned pack, which is I-7 broken by the mechanism meant to protect it. Same shape as the provenance exemption: the trail cannot be gated on the answer it supplies. What replaces the per-segment decision is coarser and enforced in the class: a run is readable back only by the principal it was assembled FOR (`recorded.query.principalId === requesterId`), on top of RLS and an explicit org_id predicate. ⚠ The exemption is valid ONLY while that check exists, so it is not left as a claim: tests/kernel/context-pack-pinned-replay.test.ts asserts another principal gets RUN_NOT_FOUND, and asserts the check is load-bearing by removing it. If that test is deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/provenance/pg-provenance-repository.ts",
    "provenance_events (and provenance_notifications, which holds only 'who was told about which event') is the AUDIT TRAIL, not tenant content: an append-only record of who touched what. Guarding it with the same filter would be circular in the same way the identity repository is -- the trail is what you consult to answer 'was that read authorised', so it cannot itself require the answer first. Who may READ the trail is enforced one layer up, in application/provenance/query-provenance.ts (project lead sees their project, everyone sees their own, nobody sees a stranger's), and that rule has its own tests.",
  ],
  [
    "src/infrastructure/auth/pg-org-invite-repository.ts",
    "F10 org-member activation: the row it reads from `org_invites` is the AUTHORITY FOR THE GRANT, not content being disclosed to a requester -- and on this path there is no requester to judge, because the caller is an anonymous visitor holding an activation token who does not yet belong to any organization. `disclose()` demands a requester and produces a decision; 'may this person read the row that decides what they are about to be granted' has no answer, so guarding it would be circular in exactly the way the identity repository's entry describes. What replaces the decision is that the invite row's CONTENT never leaves the file: `activate()` returns only the grant (userId / orgId / orgRole / teamId), never `email` and never `invited_by`; the email is used solely as an INSERT parameter for the credential row the activation creates. ⚠ The exemption is valid ONLY while that stays true, so it is not left as a claim: tests/auth/member-invite-activation.test.ts asserts the returned grant carries no invite-content field, and asserts it is load-bearing by widening the return. If that test is deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/model/pg-admission-test-repository.ts",
    "F49 model_admission_tests: `guard()` cannot express this ref, and forcing it would ALLOW EVERYONE. `ObjectRef` is project|artifact|segment|capability|organization|interview; a model is none of them, and a model has no `acl_bindings` row -- so a `model` ref pushed through `authorize` would find no binding, fall back to DEFAULT_SCOPE (org-wide), see a non-null org role and return `allowed: true` for every member. That is precisely the failure `toAclRef` throws on for `capability`, `organization` and `interview`, and adding a fourth ref kind here would be creating it rather than avoiding it. Who may read a model's admission verdicts is an ORG-ADMIN question -- the contract's `recordAdmissionTest` / `enableModel` both carry `NOT_ORG_ADMIN` and nothing finer -- decided one layer up, exactly as the provenance entry describes for its trail. ⚠ The exemption is valid ONLY while this file has no disclosure surface above it, so it is not left as a claim: tests/capability/model/admission-test-gate.test.ts asserts (a) every statement in the file names only `model_admission_tests`, (b) it never uses `withoutTenant`, (c) it returns no key outside `AdmissionTestRecord ∪ {seq}` (no credential, no endpoint, no other table's row), and (d) NOTHING under src/interface/ reaches it -- so the day a controller is added, that test goes red and whoever adds it must attach the org-admin decision there. If that test is deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-project-repository.ts",
    "F117 createProject: a WRITE path plus ONE echo of the caller's own request. `Guarded<T>` protects DISCLOSURE, and this file discloses nothing to anybody but the actor who wrote the row: three of its four statements are INSERTs (projects / the subtype table / project_creation_requests), and the fourth is the replay SELECT, keyed by `fingerprint = $1 AND actor_id = $2`. Asking `disclose()` 'may this person read the container they are creating right now' has no answer -- the container does not exist yet and, per Q-4(2), the creator deliberately holds NO project role over it, so a decision would come back NO_PROJECT_ROLE for the row the caller just wrote. Same shape as the registration entry above. ⚠ The exemption is valid ONLY while every tenant-table statement here is an INSERT or that actor-scoped SELECT, so it is not left as a claim: tests/project/create-project-idempotent.test.ts parses the file and fails if any other statement names a tenant table, and asserts the actor scoping is load-bearing (a second lead submitting the identical request gets a NEW container, never the first one's). If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/project/pg-project-list-repository.ts",
    "F122 listProjects (UC-P2): its two segments are judged by `project_memberships` (member) and `org_memberships.org_role` (managed) -- the IDENTITY DATA a decision would be made from, not `acl_bindings`. Guarding it with `authorize()`/`disclose()` would be circular in exactly the way the `pg-identity-repository.ts` entry above describes, and pushing a `project` ref through `authorize` for a listing whose whole point is 'which containers does this membership/role make visible' would ask the wrong question. D-18 already draws the line this file stays on: appearing in `managed` is NOT content read access, so the five fields it returns (id/name/kind/status/orgStatus) carry no content, no summary, no count -- only container identity and the two facts (`status`, `orgStatus`) `domain/project/readonly-reason.ts` needs to derive `readOnlyReason`. ⚠ The exemption is valid only while this file stays a pure projection of those two membership/role tables plus `organizations.status` -- adding any artifact/segment/content read here would need its own decision through `guard()`.",
  ],
  [
    "src/infrastructure/auth/pg-team-repository.ts",
    "F11 MutateTeam: `Guarded<T>` protects DISCLOSURE, and the rows this file reads are never handed to a requester as content -- they are (a) the OCCUPANCY COUNT that decides whether a delete is allowed (I-7: does any org_memberships / acl_bindings row still point at this team), which is the same shape as the identity repository's exemption -- the thing consulted to make an authorization-adjacent decision cannot itself be gated by that decision -- and (b) the team's own id/name being created, renamed or deleted, which is the actor's OWN write echoed back, same shape as the project-repository entry above. What actually reaches the HTTP response is `TeamOccupancyItem[]` (kind/id/label triples built for the 'who is using it' message the design-signoff explicitly requires), never a raw member or binding row with any other field. ⚠ The exemption is valid ONLY while that stays true, so it is not left as a claim: tests/auth/team-crud-occupancy-check.test.ts asserts the delete-blocked response's occupancy items carry exactly kind/id/label and that the team row is untouched when blocked (no partial delete). If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/auth/pg-org-member-repository.ts",
    "F11 RemoveOrgMember: same shape as `pg-org-invite-repository.ts`'s exemption above, which this file sits right next to. It DELETEs the caller's own `org_memberships` row (an admin acting inside their own organization, already authorized one layer up in the use case) and UPDATEs that member's own `pending` org_invites to `revoked` -- neither statement discloses a row's CONTENT to anyone: the method's return shape is two counts (`removed`, `revokedInvites`), never a row. The one SELECT (`credentials.email`, used only to find which invites belong to this user) never leaves the file. ⚠ The exemption is valid ONLY while `remove()` returns nothing but those counts, so it is not left as a claim: tests/auth/member-removal-preserves-attribution.test.ts asserts the use case's output shape and separately asserts the removed member's `credentials` row (their attribution) is untouched. If that test is ever deleted, this entry must go with it.",
  ],
]);

/** Parse the migrations for tenant-carrying table names. */
function tenantTables() {
  const tables = new Set();
  const roots = new Set();
  if (!existsSync(MIGRATIONS)) return tables;
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, name, body] = m;
      if (!/^\s*org_id\b/m.test(body)) continue;
      tables.add(name.toLowerCase());
      // Whatever org_id points at is the tenant root -- `organizations` is discovered, not typed.
      for (const r of body.matchAll(/^\s*org_id\b[^,]*?REFERENCES\s+(\w+)/gim)) roots.add(r[1].toLowerCase());
    }
  }
  for (const r of roots) tables.add(r);
  return tables;
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

const TABLES = tenantTables();
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : [join(API, "src")];

let fail = 0;
let scanned = 0;

// `FROM x` / `JOIN x` / `INTO x` / `UPDATE x` / `DELETE FROM x`. Deliberately SQL-keyword
// anchored: a bare identifier match would fire on the word `projects` in prose. This
// project has two precedents for a noisy gate being muted, so over-firing is treated as a
// failure mode of equal weight.
const SQL_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

for (const root of ROOTS) {
  const abs = root.startsWith("/") ? root : join(API, "..", "..", root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  for (const file of walk(abs)) {
    scanned++;
    const rel = relative(API, file);
    if (ALLOWLIST.has(rel)) continue;
    const body = readFileSync(file, "utf8");
    const guarded = body.includes(FILTER_MODULE);
    const inInfra = rel.includes("/infrastructure/") || rel.startsWith("infrastructure/");

    body.split("\n").forEach((line, i) => {
      // A comment naming a table is documentation of the rule, not a violation of it
      // (same exemption lint-error-leak makes, for the same reason).
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
      for (const m of line.matchAll(SQL_REF)) {
        const t = m[1].toLowerCase();
        if (!TABLES.has(t)) continue;
        if (inInfra && guarded) return;
        console.error(`✗ ${rel}:${i + 1}  reads tenant table \`${t}\` outside the guarded read path`);
        console.error(
          inInfra
            ? `    It is in infrastructure/ but does not import ${FILTER_MODULE}: it returns raw rows, so whatever calls it has nothing forcing a permission decision.`
            : `    Tenant data must be read in infrastructure/ and returned as Guarded<T> (${FILTER_MODULE}).`,
        );
        console.error(
          `    Why: UC-0.3 R7 -- a scope on an Artifact must reach its segments, embeddings, graph nodes, cache entries and Context Pack items. An unguarded read is how "you cannot see the original but the summary launders it out" happens.`,
        );
        fail++;
        return;
      }
    });
  }
}

console.log(
  fail === 0
    ? `✅ lint-permission-paths: every tenant-table read goes through the guarded read path`
    : `\n❌ ${fail} unguarded tenant read(s). See UC-0.3 R7 / coherence X-1.`,
);
// Machine-readable, asserted by permission-propagation-six-paths.test.ts. Against an empty
// tree, or with a table list that failed to parse, this gate exits 0 while testing nothing
// -- so the test asserts these numbers, not the exit code.
console.log(`scanned=${scanned} tenant-tables=${TABLES.size} allowlisted=${ALLOWLIST.size}`);
process.exit(fail === 0 ? 0 : 1);
