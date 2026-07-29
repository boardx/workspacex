/**
 * Shared setup for tests that need a real database.
 *
 * Real PostgreSQL, not a fake. The whole claim of F01 is that the two layers end up as a
 * judgement over `acl_bindings` under RLS -- an in-memory stub would test the shape of the
 * code and none of the thing that can actually be wrong.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const COMPOSE = ["compose", "-f", `${API_DIR}/docker-compose.dev.yml`, "-p", "workspacex-kernel"];

/**
 * The database name comes from WORKSPACEX_DB, so parallel workers do not share one.
 *
 * The gate scripts run DROP DATABASE; without per-worker names, two workers destroy each
 * other's fixtures mid-run and the failure looks like flaky tests rather than a collision.
 */
const DB = process.env.WORKSPACEX_DB ?? "workspacex";

/**
 * ...and it has to reach the CONNECTION, which for a while it did not (found in F02).
 *
 * `pg-config` reads `PGDATABASE`; only `scripts/lib.sh` translated WORKSPACEX_DB into it.
 * So `WORKSPACEX_DB=wsx_xx pnpm exec vitest run` -- the documented way to run a worker's
 * tests -- created `wsx_xx` above and then connected to the shared `workspacex` anyway.
 * The isolation the comment above promises was not in effect for a single vitest run, and
 * nothing could have told you: cross-worker interference shows up as flaky assertions, not
 * as an error.
 *
 * Assigned rather than overwritten: lib.sh sets PGDATABASE explicitly for the shell gates,
 * and that setting has to win.
 */
if (process.env.PGDATABASE === undefined || process.env.PGDATABASE === "") {
  process.env.PGDATABASE = DB;
}

export function ensureDatabase(): void {
  execFileSync("docker", [...COMPOSE, "up", "-d", "postgres"], { stdio: "pipe" });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      // Readiness against the SERVER: a per-worker database may not exist yet.
      execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "pg_isready", "-U", "postgres"], { stdio: "pipe" });
      ready = true;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  if (!ready) throw new Error("postgres did not become ready");
  createDatabaseIfMissing();
}

/**
 * Create the worker's database, tolerating the race.
 *
 * vitest runs test FILES in parallel, and every one of them calls `ensureDatabase()`. A
 * check-then-create is not atomic: nine processes all see "missing" and eight of them then
 * fail on CREATE. That is not a hypothetical -- it is what a fresh database did on the
 * first run, with six of nine files erroring out in beforeAll and 154 tests reported as
 * "skipped", which reads like a config problem rather than a race.
 *
 * So: attempt it, and treat "already exists" (SQLSTATE 42P04) as success. Losing the race
 * is the expected outcome for eight of nine callers.
 */
function createDatabaseIfMissing(): void {
  if (DB === "workspacex") return; // the shared default is created by docker-compose
  try {
    execFileSync(
      "docker",
      [...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
        "-c", `CREATE DATABASE ${DB}`],
      { stdio: "pipe", encoding: "utf8" },
    );
  } catch (e) {
    const out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
    // 42P04 = duplicate_database. Anything else is a real failure and must surface.
    if (!/already exists|42P04/i.test(out)) throw e;
  }
}

/**
 * Delete the named organizations and everything hanging off them.
 *
 * SCOPED, not a global TRUNCATE. The first version truncated every identity table, which
 * passed when each test file ran alone and failed the moment vitest ran them in parallel
 * against the same database: one file's cleanup deleted another file's fixtures mid-test.
 * Every test file therefore owns its own org ids and cleans up only those.
 *
 * Runs as the OWNER on purpose: the app role (correctly) cannot see other tenants' rows, so
 * a tenant-scoped cleanup would leave rows behind -- and a row left over from a previous
 * test is how a cross-tenant assertion accidentally passes.
 */
export async function resetOrgs(...orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const c = new pg.Client(migrationConfig());
  await c.connect();
  // ON DELETE CASCADE carries teams / projects / groups / memberships / bindings with it.
  await c.query("DELETE FROM organizations WHERE id = ANY($1::text[])", [orgIds]);
  await c.end();
}

export async function migrateOnce(): Promise<void> {
  await migrate(migrationConfig());
}

/** Runs SQL as the OWNER. Fixture setup only -- never used to assert anything. */
export async function asOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(migrationConfig());
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Runs SQL as the APP role inside a tenant transaction -- the path production uses. */
export async function asApp<T>(orgId: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(appConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    if (orgId !== null) await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

export interface OrgFixture {
  orgId: string;
  teams: Record<string, string>;
  projectId: string;
  groups: Record<string, string>;
}

/**
 * Build one organization's worth of fixture.
 *
 * Inserted as the app role under tenant scope, not as the owner. That is deliberate: if a
 * policy's WITH CHECK were wrong, owner-side inserts would sail through and the tests would
 * be built on data that production could never have written.
 */
export async function seedOrg(opts: {
  orgId: string;
  kind?: "organization" | "personal-local";
  teamNames?: string[];
  projectId: string;
  groupNames?: string[];
}): Promise<OrgFixture> {
  const { orgId, projectId } = opts;
  const teamNames = opts.teamNames ?? ["energy", "platform"];
  const groupNames = opts.groupNames ?? ["g1", "g2"];
  const teams: Record<string, string> = {};
  const groups: Record<string, string> = {};

  await asApp(orgId, async (c) => {
    await c.query("INSERT INTO organizations (id, name, kind) VALUES ($1, $2, $3)", [
      orgId, `org ${orgId}`, opts.kind ?? "organization",
    ]);
    for (const t of teamNames) {
      const id = `${orgId}-team-${t}`;
      await c.query("INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)", [id, orgId, t]);
      teams[t] = id;
    }
    await c.query("INSERT INTO projects (id, org_id, name) VALUES ($1, $2, $3)", [projectId, orgId, `project ${projectId}`]);
    for (const g of groupNames) {
      const id = `${projectId}-${g}`;
      await c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1, $2, $3, $4)", [id, orgId, projectId, g]);
      groups[g] = id;
    }
  });

  return { orgId, teams, projectId, groups };
}

export async function addOrgMember(orgId: string, userId: string, orgRole: string, teamId: string | null): Promise<void> {
  await asApp(orgId, (c) =>
    c.query("INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, $3, $4)", [
      userId, orgId, orgRole, teamId,
    ]),
  );
}

export async function addProjectMember(
  orgId: string, projectId: string, userId: string, projectRole: string, groupId: string | null, isHost = false,
): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      "INSERT INTO project_memberships (user_id, project_id, org_id, project_role, group_id, is_host) VALUES ($1,$2,$3,$4,$5,$6)",
      [userId, projectId, orgId, projectRole, groupId, isHost],
    ),
  );
}

/**
 * Seed one content item.
 *
 * `layer` defaults to `project` and `status` to `published` because that is the ordinary
 * case; the interesting fixtures (personal items, other people's drafts) name what makes
 * them interesting at the call site rather than relying on a default.
 */
export async function addContentItem(opts: {
  orgId: string;
  id: string;
  ownerUserId: string;
  body: string;
  layer?: "personal" | "project";
  projectId?: string | null;
  groupId?: string | null;
  status?: "draft" | "published";
}): Promise<void> {
  const layer = opts.layer ?? "project";
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO content_items (id, org_id, layer, project_id, group_id, owner_user_id, status, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        opts.id, opts.orgId, layer,
        layer === "personal" ? null : (opts.projectId ?? null),
        layer === "personal" ? null : (opts.groupId ?? null),
        opts.ownerUserId, opts.status ?? "published", opts.body,
      ],
    ),
  );
}

export async function addBinding(opts: {
  orgId: string;
  subject: { kind: "user" | "group" | "team"; id: string };
  object: { kind: "project" | "artifact" | "segment"; id: string };
  scope: "org-wide" | "team-only";
  ownerTeamId?: string | null;
}): Promise<void> {
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO acl_bindings (org_id, subject_kind, subject_id, object_kind, object_id, scope, owner_team_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [opts.orgId, opts.subject.kind, opts.subject.id, opts.object.kind, opts.object.id, opts.scope, opts.ownerTeamId ?? null],
    ),
  );
}

/**
 * A listening port that is unique per worker.
 *
 * Test files that boot the app bind a fixed port. Two workers running the full suite at
 * once therefore collide on it -- `EADDRINUSE` on the SECOND worker, reported as a failing
 * test file rather than as a resource clash. Database isolation alone does not buy
 * parallelism; the ports have to move too.
 *
 * Derived from WORKSPACEX_DB so it is stable within a worker (a rerun binds the same port,
 * which matters when a previous run left a socket in TIME_WAIT) and disjoint across
 * workers. The offset is bounded so it cannot wander into the ephemeral range.
 */
export function workerPort(base: number): number {
  let h = 0;
  for (const ch of DB) h = (h * 31 + ch.charCodeAt(0)) % 97;
  return base + h * 20;
}
