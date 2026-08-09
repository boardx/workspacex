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
const COMPOSE = [
  "compose", "-f", `${API_DIR}/docker-compose.dev.yml`, "-p",
  process.env.COMPOSE_PROJECT_NAME ?? "workspacex-kernel",
];

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

/** Is the compose postgres container up and accepting connections? */
function postgresReady(): boolean {
  try {
    execFileSync("docker", [...COMPOSE, "exec", "-T", "postgres", "pg_isready", "-U", "postgres"], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function ensureDatabase(): void {
  // `docker compose up` is NOT safe to call concurrently.
  //
  // vitest runs test files in parallel processes and every one of them calls this. When the
  // container does not exist yet, they all try to create it and eleven of twelve die with
  // `Conflict. The container name "..." is already in use`.
  //
  // This never happens locally, because the container has been up for hours by the time you
  // run anything -- `up -d` is then a no-op and the race has nothing to race on. It fired on
  // the very first CI run, on a machine where nothing was running yet. Same shape as the
  // CREATE DATABASE race fixed earlier: an operation that is idempotent in its *effect* but
  // not in its *execution*.
  //
  // So: check first, and treat losing the create race as success -- the winner's container
  // is exactly what we wanted. Only a container that never becomes ready is a real failure.
  if (!postgresReady()) {
    try {
      execFileSync("docker", [...COMPOSE, "up", "-d", "postgres"], { stdio: "pipe" });
    } catch (e) {
      const out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
      // Losing to a concurrent creator is the expected outcome for most callers.
      if (!/already in use|Conflict/i.test(out)) throw e;
    }
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      ready = postgresReady();
      if (!ready) execFileSync("sleep", ["1"]);
    }
    if (!ready) throw new Error("postgres did not become ready");
  }
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
  /**
   * Required in effect for `kind: "personal-local"` (F16 / migration 0012): a local
   * organization without an owner cannot exist -- the CHECK refuses it. Defaulted rather than
   * made mandatory so the existing call sites that do not care keep reading as they did, but
   * a test that seeds a local org and then adds a member has to use THIS id, because the
   * single-member trigger admits only the owner.
   */
  ownerUserId?: string;
  teamNames?: string[];
  projectId: string;
  /** F116: which of the three container kinds. Defaults to `workshop` -- the only kind
   *  that has groups and the four project roles, which is what every existing fixture
   *  relies on. A test about the other two kinds says so at the call site. */
  projectKind?: "workshop" | "research_project" | "user_insight";
  groupNames?: string[];
  /**
   * F11: `organizations.seat_quota` (migration 20260731085758) defaults to 0 in
   * production -- "unallocated" is the deliberate starting state (O-29 ⑤), not an
   * oversight a fixture should paper over. But every fixture written BEFORE F11 calls
   * `inviteOrgMember` never having heard of a seat limit, and a column that starts at
   * 0 in production cannot also start at 0 here without breaking every one of them on
   * the day quota enforcement lands (`member-invite-activation.test.ts` did, verified).
   * Defaulted generously high so pre-F11 fixtures keep reading exactly as they did;
   * a test that specifically exercises `QUOTA_EXHAUSTED` sets it explicitly (see
   * `tests/auth/quota-exhausted-hard-block.test.ts`), which is the only place a small
   * number belongs.
   */
  seatQuota?: number;
}): Promise<OrgFixture> {
  const { orgId, projectId } = opts;
  const teamNames = opts.teamNames ?? ["energy", "platform"];
  const groupNames = opts.groupNames ?? ["g1", "g2"];
  const seatQuota = opts.seatQuota ?? 1000;
  const teams: Record<string, string> = {};
  const groups: Record<string, string> = {};

  await asApp(orgId, async (c) => {
    const kind = opts.kind ?? "organization";
    await c.query(
      "INSERT INTO organizations (id, name, kind, owner_user_id, seat_quota) VALUES ($1, $2, $3, $4, $5)",
      [
        orgId,
        `org ${orgId}`,
        kind,
        kind === "personal-local" ? (opts.ownerUserId ?? `${orgId}-owner`) : null,
        seatQuota,
      ],
    );
    for (const t of teamNames) {
      const id = `${orgId}-team-${t}`;
      await c.query("INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)", [id, orgId, t]);
      teams[t] = id;
    }
    // F116: `kind` is a discriminator with NO default -- "I forgot to say which of the
    // three kinds this is" must not be silently writable. Fixtures default to `workshop`
    // because that is what every pre-F116 caller meant, and say so explicitly.
    const projectKind = opts.projectKind ?? "workshop";
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, $3, $4)", [
      projectId, orgId, `project ${projectId}`, projectKind,
    ]);
    // F116 requires a matching 1:1 subtype row (I-P34's composite FK rejects a bare
    // `projects` row with no subtype). This fixture predates F116 and only ever wrote
    // `projects`; F118 makes the gap visible for the first time because
    // `agenda_segments.workshop_id` has its own FK into `workshops(id, org_id)` --
    // without this row, seeding a segment for a `seedOrg`-created container fails with
    // `agenda_segments_workshop_org_fkey`, not because agenda_segments is wrong, but
    // because the container it points at was never actually a real workshop.
    const subtypeTable =
      projectKind === "workshop"
        ? "workshops"
        : projectKind === "research_project"
          ? "research_projects"
          : "user_insights";
    await c.query(`INSERT INTO ${subtypeTable} (id, org_id) VALUES ($1, $2)`, [projectId, orgId]);
    for (const g of groupNames) {
      const id = `${projectId}-${g}`;
      await c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1, $2, $3, $4)", [id, orgId, projectId, g]);
      groups[g] = id;
    }
  });

  return { orgId, teams, projectId, groups };
}

/**
 * #363 delta：`listOrgMembers` 需要真实的 `email`/`displayName`——两者住在 `credentials`，
 * 不是 `org_memberships`。`credentials` 不是租户表（`withoutTenant` 写入，同
 * `pg-credential-repository.ts` 的既有处置），密码哈希用一个满足
 * `credentials_hash_is_slow` CHECK 形状的占位值（bcrypt 前缀 + 任意内容，正则不锚定
 * 结尾），这里从不做真实登录。
 */
export async function addCredential(userId: string, email: string, displayName: string): Promise<void> {
  const c = new pg.Client(migrationConfig());
  await c.connect();
  try {
    await c.query(
      `INSERT INTO credentials (user_id, email, password_hash, display_name, email_verified_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, email, `$2b$12$${"a".repeat(53)}`, displayName],
    );
  } finally {
    await c.end();
  }
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

/**
 * Seed one artifact.
 *
 * Needed by every test that binds an ACL to `object_kind = 'artifact'`. Before F04 those
 * bindings named ids with no row behind them, because the table did not exist; migration
 * 0006 closes the gap 0003 wrote down, so the referent now has to be real.
 *
 * That is not fixture bureaucracy: `acl_bindings_uniq` keys on a caller-supplied object id,
 * so a binding naming an artifact that does not exist sits there until an artifact IS
 * created with that id -- and then arrives pre-granted to whoever the stale row names.
 */
export async function addArtifact(opts: {
  orgId: string;
  id: string;
  projectId?: string | null;
  source?: string;
  createdBy?: string;
}): Promise<void> {
  const source = opts.source ?? "upload";
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        opts.id, opts.orgId, opts.projectId ?? null, source, `artifact ${opts.id}`,
        opts.createdBy ?? "u-seed", source === "ai-generated",
      ],
    ),
  );
}

/**
 * Seed an artifact version, a segment under it, and the segment's anchor -- in ONE
 * transaction.
 *
 * The three cannot be separated: I-7 is a DEFERRED constraint, so a transaction that commits
 * a segment without an anchor is rejected at COMMIT. Doing it in one call is therefore the
 * honest shape rather than a convenience -- a helper that inserted only the segment would be
 * a helper that always fails.
 *
 * Creates the artifact too when it is absent, because a version needs one and a test that
 * only cares about segment-level ACLs should not have to say so.
 */
export async function addSegment(opts: {
  orgId: string;
  segmentId: string;
  artifactId: string;
  versionId?: string;
  ordinal?: number;
  anchor?: { kind: string; locator: string };
}): Promise<{ versionId: string }> {
  const versionId = opts.versionId ?? `${opts.segmentId}-v1`;
  const anchor = opts.anchor ?? { kind: "page", locator: "1" };
  await asApp(opts.orgId, async (c) => {
    // F16: a personal-local organization's objects must live under `local/<orgId>/`, and the
    // trigger in migration 0012 enforces it both ways. Derived here rather than passed in,
    // so a test that happens to seed a local org cannot accidentally place its bytes in the
    // shared key space -- which is the very thing the trigger exists to prevent.
    const kindRow = await c.query<{ kind: string }>(
      "SELECT kind FROM organizations WHERE id = $1", [opts.orgId],
    );
    const keyPrefix = kindRow.rows[0]?.kind === "personal-local"
      ? `local/${opts.orgId}/`
      : `${opts.orgId}/`;
    await c.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,NULL,'upload',$3,'u-seed',false) ON CONFLICT (id) DO NOTHING`,
      [opts.artifactId, opts.orgId, `artifact ${opts.artifactId}`],
    );
    await c.query(
      `INSERT INTO artifact_versions
         (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime,
          size_bytes, pinned_by)
       VALUES ($1,$2,$3,1,$4,$5,'application/octet-stream',1,'u-seed')
       ON CONFLICT (id) DO NOTHING`,
      [
        versionId, opts.orgId, opts.artifactId,
        `${keyPrefix}artifacts/${opts.artifactId}/v1/${versionId}`,
        // A syntactically valid SHA-256 -- the column constrains its shape, and a fixture
        // that says "deadbeef" would fail for a reason unrelated to what a test is asserting.
        "0".repeat(64),
      ],
    );
    await c.query(
      `INSERT INTO segments (id, org_id, artifact_version_id, kind, ordinal) VALUES ($1,$2,$3,'text',$4)`,
      [opts.segmentId, opts.orgId, versionId, opts.ordinal ?? 0],
    );
    await c.query(
      `INSERT INTO anchors (id, org_id, segment_id, kind, locator) VALUES ($1,$2,$3,$4,$5)`,
      [`${opts.segmentId}-anchor`, opts.orgId, opts.segmentId, anchor.kind, anchor.locator],
    );
  });
  return { versionId };
}

/**
 * Seed one capability listing.
 *
 * ⚠ There is no `seedDefaultCapabilities()` and there must never be one. F15's acceptance V1
 * is that an unconfigured organization is EMPTY, so every test that wants capabilities says
 * exactly which ones it wants at the call site -- and a test that says nothing gets nothing,
 * which is the case V1 is about. A convenience helper that seeded "the usual six" would
 * quietly re-create the built-in list inside the test suite, where nothing scans for it.
 *
 * Inserted as the app role under tenant scope, like every other fixture: if a policy's WITH
 * CHECK were wrong, owner-side inserts would sail through and the tests would rest on data
 * production could never have written.
 */
export async function addCapability(opts: {
  orgId: string;
  id: string;
  kind: "agent" | "skill" | "model" | "mcp" | "canvas-template" | "blueprint";
  name: string;
  scope?: "org-wide" | "team-only";
  ownerTeamId?: string | null;
  enabled?: boolean;
  /**
   * Where it runs (F16). Left null by default because most kinds have no endpoint; a test
   * that seeds a MODEL says where it lives, and in a personal-local organization migration
   * 0012 will refuse anything that is not loopback -- which is itself an assertion worth
   * having available at the fixture level.
   */
  endpoint?: string | null;
  /**
   * #619：`kind: "agent"` 时数据库 CHECK 要求非空（`capability_listings_agent_needs_abbr_duty`）。
   * 缺省给一个测试安全的值，而不是要求每个既有调用点都改——这条 CHECK 测的是"agent
   * 必须有这两个字段"，不是"这个具体测试关心 abbr/duty 长什么样"，所以对不关心这
   * 两个字段的既有测试，缺省值就够了；真的要断言 abbr/duty 内容的测试自己传。
   */
  abbr?: string | null;
  duty?: string | null;
}): Promise<void> {
  const isAgent = opts.kind === "agent";
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO capability_listings
         (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint, abbr, duty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        opts.id, opts.orgId, opts.kind, opts.name,
        opts.scope ?? "org-wide", opts.ownerTeamId ?? null, opts.enabled ?? true,
        opts.endpoint ?? null,
        opts.abbr ?? (isAgent ? opts.name.slice(0, 2) : null),
        opts.duty ?? (isAgent ? "test fixture agent" : null),
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
 * F118: a real `agenda_segments` row for a phase-00 fixture's `agendaSegmentId`.
 *
 * `artifact_bindings.agenda_segment_id` (F121 renamed it from its phase-00 name; the
 * column gained a composite FK in F118 under that earlier name) is backed by
 * `artifact_bindings_segment_fkey` -> `agenda_segments(id, workshop_id, org_id)`. Every
 * F06-era test that calls `bindToProjectStep` with a bare string like `"s1"` or
 * `"step-lead"` now needs a matching row here first, or the insert is refused as an orphan
 * binding -- which is exactly what the constraint is for, just not what those tests were
 * about. `seedOrg`'s `projectId` IS the workshop id (F116 supertype model), so `workshopId`
 * below is that same id, not a new concept.
 *
 * ⚠ Ordinal is not meaningful across a fixture's various segment ids (tests seed them in
 *   whatever order the scenario needs), so it defaults to 0 for every row -- nothing in
 *   these files reads it.
 * ⚠ State defaults to `pending`, NOT `active` -- these fixtures routinely seed several
 *   distinct segment ids under ONE workshop (binding-three-modes alone uses ten), and I-P44's
 *   partial unique index allows at most one `active` row per workshop. `pending` is a
 *   legal, permanent resting state that never collides with a sibling segment.
 */
export async function seedAgendaSegment(
  orgId: string,
  workshopId: string,
  segmentId: string,
): Promise<void> {
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,0,$4,15,'pending')
       ON CONFLICT (id) DO NOTHING`,
      [segmentId, orgId, workshopId, `segment ${segmentId}`],
    ),
  );
}
