/**
 * 项目中枢 B2-S1（#4425）—— `PgProjectResourceRepository` 对真实 PostgreSQL 的断言
 * （装配同 `list-projects-flat.test.ts`）。用例层的编排见 `project-resources.test.ts`。
 *
 * 钉住：
 *   · 四类聚合一次查出（三类经链接表、访谈按 `interview_sessions.project_id`），标题/状态/所有者
 *     从各自的表投影（问卷标题在 jsonb 里）；
 *   · 挂两次幂等（alreadyLinked），从 A 改挂到 B 后 A 里不再出现；
 *   · 解挂后资源仍在（只是链接行没了）；不是自己的资源 `isOwnedResource` 为 false；
 *   · 跨租户：另一组织同 id 的资源看不到、挂不上（RLS + org_id 谓词）；
 *   · 资源被删后链接行悬空，读侧自然过滤。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listProjectResources } from "../../src/application/project/list-project-resources";
import { linkProjectResource } from "../../src/application/project/link-project-resource";
import { unlinkProjectResource } from "../../src/application/project/unlink-project-resource";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProjectResourceRepository } from "../../src/infrastructure/project/pg-project-resource-repository";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const HOOK_TIMEOUT_MS = 120_000;
const ORG = "org-b2s1-pg";
const OTHER = "org-b2s1-pg-other";
const ORG_ID = toOrgId(ORG);
const P_A = `${ORG}-pa`;
const P_B = `${ORG}-pb`;
const OWNER = "u-owner";
const OBSERVER = "u-observer";

let db: PgDatabase;
let repo: PgProjectResourceRepository;
let deps: Parameters<typeof listProjectResources>[0];

/**
 * `suffix`：`guided_research_sessions.id`（F168）与 `personal_transcriptions.id` 都是全局主键，不像
 * `survey_workspaces` 按 (org_id, id) 分租户——另一租户的深研会话 / 转写必须换 id。
 * 跨租户反证只用问卷 `s1`，不受影响。
 */
async function seedResources(orgId: string, owner: string, suffix = ""): Promise<void> {
  const researchId = `g1${suffix}`;
  const transcriptionId = `t1${suffix}`;
  await asApp(orgId, async (c) => {
    await c.query(
      `INSERT INTO survey_workspaces (org_id, id, owner_id, document) VALUES ($1, 's1', $2, $3::jsonb)`,
      [orgId, owner, JSON.stringify({ ownerId: owner, model: { id: "s1", title: "问卷一", status: "collecting" }, receipts: {} })],
    );
    await c.query(
      `INSERT INTO guided_research_sessions (id, org_id, owner_user_id, idempotency_key, title, brief, stage, resume_stage)
       VALUES ($3, $1, $2, $4, '研究一', '{}'::jsonb, 'outline', 'outline')`,
      [orgId, owner, researchId, `k-${researchId}`],
    );
    await c.query(
      `INSERT INTO personal_transcriptions (id, org_id, owner_user_id, name, status) VALUES ($3, $1, $2, '转写一', 'idle')`,
      [orgId, owner, transcriptionId],
    );
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProjectResourceRepository(db);
  deps = { auth: { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() }, resources: repo };
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: P_A });
  // 第二个容器也得是 workshop：`project_memberships` 的复合外键 (project_id, kind) 只认
  // workshop（F128 迁移 20260801190000），research_project 容器挂不上项目成员（CI 实录 23503）。
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, 'B', 'workshop')", [P_B, ORG]);
    await c.query("INSERT INTO workshops (id, org_id) VALUES ($1, $2)", [P_B, ORG]);
  });
  await addOrgMember(ORG, OWNER, "consultant", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, P_A, OWNER, "member", null);
  await addProjectMember(ORG, P_A, OBSERVER, "observer", null);
  await addProjectMember(ORG, P_B, OWNER, "member", null);
  await seedResources(ORG, OWNER);
  // 另一租户：同 id 的资源与同名成员，用来证明 org_id 谓词 + RLS 生效。
  await seedOrg({ orgId: OTHER, projectId: `${OTHER}-p` });
  await seedResources(OTHER, OWNER, `-${OTHER}`);
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_sessions (id, org_id, project_id, source_kind, title, created_by, digital_status)
       VALUES ('i1', $1, $2, 'human', '访谈一', $3, NULL)`,
      [ORG, P_A, OWNER],
    ),
  );
}, HOOK_TIMEOUT_MS);

const asUser = (userId: string, projectId = P_A) => ({ userId, orgId: ORG_ID, projectId });

describe("PgProjectResourceRepository（真实 PG）", () => {
  it("四类聚合：三类挂上后与访谈一起出现，字段来自各自的表；观察者也能读", async () => {
    for (const [kind, resourceId] of [["survey", "s1"], ["guided_research", "g1"], ["personal_transcription", "t1"]] as const) {
      const out = await linkProjectResource(deps, { ...asUser(OWNER), kind, resourceId });
      expect(out.alreadyLinked).toBe(false);
    }
    const out = await listProjectResources(deps, asUser(OBSERVER));
    expect(out.counts).toEqual({ survey: 1, guided_research: 1, personal_transcription: 1, interview: 1 });
    const byKind = Object.fromEntries(out.items.map((x) => [x.kind, x]));
    expect(byKind.survey).toMatchObject({ id: "s1", title: "问卷一", status: "collecting", ownerUserId: OWNER });
    expect(byKind.guided_research).toMatchObject({ id: "g1", title: "研究一", status: "outline", ownerUserId: OWNER });
    expect(byKind.personal_transcription).toMatchObject({ id: "t1", title: "转写一", status: "idle", ownerUserId: OWNER });
    expect(byKind.interview).toMatchObject({ id: "i1", title: "访谈一", status: null, ownerUserId: OWNER });
    for (const it of out.items) {
      expect(() => new Date(it.linkedAt).toISOString()).not.toThrow();
      expect(() => new Date(it.updatedAt).toISOString()).not.toThrow();
    }
    // 三类按 linkedAt 倒序排在前面（访谈的 linkedAt 是其 created_at，在 seed 时最早）。
    expect(out.items.at(-1)?.kind).toBe("interview");
  });

  it("挂两次幂等；改挂到另一个项目后原项目里不再出现", async () => {
    const cmd = { ...asUser(OWNER), kind: "survey" as const, resourceId: "s1" };
    expect((await linkProjectResource(deps, cmd)).alreadyLinked).toBe(false);
    expect((await linkProjectResource(deps, cmd)).alreadyLinked).toBe(true);
    expect((await linkProjectResource(deps, { ...cmd, projectId: P_B })).alreadyLinked).toBe(false);
    expect((await listProjectResources(deps, asUser(OWNER))).counts.survey).toBe(0);
    expect((await listProjectResources(deps, asUser(OWNER, P_B))).counts.survey).toBe(1);
  });

  it("解挂：链接行没了，资源仍在；再解一次 removed=false", async () => {
    await linkProjectResource(deps, { ...asUser(OWNER), kind: "personal_transcription", resourceId: "t1" });
    expect(await unlinkProjectResource(deps, { ...asUser(OWNER), kind: "personal_transcription", resourceId: "t1" })).toEqual({ removed: true });
    expect(await unlinkProjectResource(deps, { ...asUser(OWNER), kind: "personal_transcription", resourceId: "t1" })).toEqual({ removed: false });
    expect((await listProjectResources(deps, asUser(OWNER))).counts.personal_transcription).toBe(0);
    const still = await asApp(ORG, (c) => c.query("SELECT 1 FROM personal_transcriptions WHERE org_id = $1 AND id = 't1'", [ORG]));
    expect(still.rows).toHaveLength(1);
  });

  it("不是自己的资源 ⇒ RESOURCE_NOT_FOUND（观察者挂所有者的问卷）", async () => {
    await expect(
      linkProjectResource(deps, { ...asUser(OBSERVER), kind: "survey", resourceId: "s1" }),
    ).rejects.toMatchObject({ reasonCode: "RESOURCE_NOT_FOUND" });
    expect(await repo.isOwnedResource(ORG_ID, "survey", "s1", OBSERVER)).toBe(false);
    expect(await repo.isOwnedResource(ORG_ID, "survey", "s1", OWNER)).toBe(true);
  });

  it("跨租户：另一组织的同 id 资源看不到也挂不上", async () => {
    expect(await repo.isOwnedResource(toOrgId(OTHER), "survey", "s1", OBSERVER)).toBe(false);
    await linkProjectResource(deps, { ...asUser(OWNER), kind: "survey", resourceId: "s1" });
    const other = await asApp(OTHER, (c) => c.query("SELECT * FROM project_resource_links"));
    expect(other.rows).toHaveLength(0);
  });

  it("资源被删后链接行悬空，读侧自然过滤（计数随之归零）", async () => {
    await linkProjectResource(deps, { ...asUser(OWNER), kind: "guided_research", resourceId: "g1" });
    // `guided_research_sessions` 对 app_rw 只放 SELECT/INSERT（F168/F169：会话只增不删），
    // 「资源被删」这一格只能由表 owner 模拟——读侧过滤悬空链接与谁删的无关。
    await asOwner((c) => c.query("DELETE FROM guided_research_sessions WHERE org_id = $1 AND id = 'g1'", [ORG]));
    expect((await listProjectResources(deps, asUser(OWNER))).counts.guided_research).toBe(0);
  });

  it("非成员 ⇒ NO_PROJECT_ROLE；不存在的容器同码", async () => {
    await addOrgMember(ORG, "u-stranger", "consultant", null);
    await expect(listProjectResources(deps, asUser("u-stranger"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(listProjectResources(deps, asUser(OWNER, "no-such-project"))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});
