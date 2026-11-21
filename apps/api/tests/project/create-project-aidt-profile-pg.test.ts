/** Real PostgreSQL atomicity/replay proofs; this file must never be DB-free. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { project } from "@repo/contracts";
import { createProject } from "../../src/application/project/create-project";
import { updateProjectTags } from "../../src/application/project/update-project-tags";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { PgProjectTagsRepository } from "../../src/infrastructure/project/pg-project-tags-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "aidt-atomic-profile-org-6824", ACTOR = "aidt-atomic-consultant-6824";
const base = { orgId: toOrgId(ORG), actorId: ACTOR, kind: "general", name: "AIDT controlled create", blueprintVersionId: null, profile: "aidt" as const };
const TAG = project.PROJECT_CREATION_PROFILE_TAGS.aidt;
let db: PgDatabase, identity: PgIdentityRepository, repo: PgProjectRepository;

class TagWriteFault implements DatabasePort {
  readonly cause = new Error("synthetic controlled tag write failure");
  constructor(private readonly inner: DatabasePort, private readonly failTag = true) {}
  withTenant<T>(orgId: OrgId, work: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inner.withTenant(orgId, session => work({ query: async (sql, params) => {
      if (this.failTag && /INSERT\s+INTO\s+project_tags/i.test(sql)) throw this.cause;
      return session.query(sql, params);
    } }));
  }
  withoutTenant<T>(work: (s: TenantSession) => Promise<T>): Promise<T> { return this.inner.withoutTenant(work); }
  close(): Promise<void> { return Promise.resolve(); }
}
async function counts() {
  return asApp(ORG, async session => {
    const read = async (table: string) => Number((await session.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [ORG])).rows[0]!.n);
    return { projects: await read("projects"), subtypes: await read("general_projects"), owners: await read("general_project_members"), requests: await read("project_creation_requests"), tags: await read("project_tags") };
  });
}
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db); repo = new PgProjectRepository(db, new UuidIdFactory());
}, 120000);
beforeEach(async () => {
  await resetOrgs(ORG);
  await asApp(ORG, session => session.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, "Atomic AIDT QA"]));
  await addOrgMember(ORG, ACTOR, "consultant", null);
}, 120000);
afterAll(async () => { await resetOrgs(ORG); await db?.close(); }, 120000);

describe("AIDT controlled creation in the original tenant transaction", () => {
  it("persists project, creator owner and fixed tag together, without giving tag management permission", async () => {
    const created = await createProject({ repo, identity }, base);
    expect(await counts()).toEqual({ projects: 1, subtypes: 1, owners: 1, requests: 1, tags: 1 });
    const rows = await asApp(ORG, session => session.query(
      "SELECT m.role, t.tag FROM general_project_members m JOIN project_tags t ON t.project_id=m.project_id AND t.org_id=m.org_id WHERE m.project_id=$1 AND m.user_id=$2", [created.id, ACTOR]));
    expect(rows.rows).toEqual([{ role: "owner", tag: TAG }]);
    await expect(updateProjectTags({ repo: new PgProjectTagsRepository(db), identity }, { orgId: toOrgId(ORG), actorId: ACTOR, projectId: created.id, tags: ["arbitrary"] })).rejects.toMatchObject({ reasonCode: "ORG_ROLE_INSUFFICIENT" });
    expect(await counts()).toEqual({ projects: 1, subtypes: 1, owners: 1, requests: 1, tags: 1 });
  });

  it("rolls back every creation row when the fixed tag write fails, including the replay claim", async () => {
    const faulty = new TagWriteFault(db), failedRepo = new PgProjectRepository(faulty, new UuidIdFactory());
    await expect(createProject({ repo: failedRepo, identity }, base)).rejects.toBe(faulty.cause);
    expect(await counts()).toEqual({ projects: 0, subtypes: 0, owners: 0, requests: 0, tags: 0 });
    // An actual retry after a known rollback can create the complete project.
    const created = await createProject({ repo, identity }, base);
    expect(created.created).toBe(true);
    expect(await counts()).toEqual({ projects: 1, subtypes: 1, owners: 1, requests: 1, tags: 1 });
  });

  it("fault injection has a successful control and detects the old split-transaction pattern", async () => {
    const healthy = new TagWriteFault(db, false);
    await createProject({ repo: new PgProjectRepository(healthy, new UuidIdFactory()), identity }, base);
    expect((await counts()).tags).toBe(1);
    const { profile: _profile, ...ordinary } = { ...base, name: "Deliberate split-transaction counterproof" };
    const prior = await createProject({ repo, identity }, ordinary);
    const faulty = new TagWriteFault(db);
    await expect(faulty.withTenant(toOrgId(ORG), s => s.query("INSERT INTO project_tags (project_id,org_id,tag) VALUES ($1,$2,$3)", [prior.id, ORG, TAG]))).rejects.toBe(faulty.cause);
    // The original separately committed project survives: the fault is not a fake blanket rollback.
    expect(await counts()).toEqual({ projects: 2, subtypes: 2, owners: 2, requests: 2, tags: 1 });
  });

  it("concurrent identical AIDT requests leave exactly one project/owner/tag", async () => {
    const [first, second] = await Promise.all([createProject({ repo, identity }, base), createProject({ repo, identity }, base)]);
    expect(first.id).toBe(second.id); expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(await counts()).toEqual({ projects: 1, subtypes: 1, owners: 1, requests: 1, tags: 1 });
  });

  it("does not confuse an ordinary same-name request with AIDT initialization", async () => {
    const { profile: _profile, ...ordinary } = base;
    const plain = await createProject({ repo, identity }, ordinary), aidt = await createProject({ repo, identity }, base);
    expect(plain.id).not.toBe(aidt.id);
    expect(await counts()).toEqual({ projects: 2, subtypes: 2, owners: 2, requests: 2, tags: 1 });
    const tags = await asApp(ORG, s => s.query("SELECT project_id,tag FROM project_tags WHERE org_id=$1", [ORG]));
    expect(tags.rows).toEqual([{ project_id: aidt.id, tag: TAG }]);
  });

  it("replay never restores deleted membership/tag or an archived project's lifecycle", async () => {
    const first = await createProject({ repo, identity }, base);
    await asApp(ORG, async s => {
      await s.query("DELETE FROM project_tags WHERE project_id=$1", [first.id]);
      await s.query("DELETE FROM general_project_members WHERE project_id=$1", [first.id]);
      await s.query("UPDATE projects SET status='archived' WHERE id=$1", [first.id]);
    });
    const replay = await createProject({ repo, identity }, base);
    expect(replay).toMatchObject({ id: first.id, status: "archived", created: false });
    expect(await counts()).toEqual({ projects: 1, subtypes: 1, owners: 0, requests: 1, tags: 0 });
  });
});
