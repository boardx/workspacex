/**
 * 项目中枢 B3-T5（#4499）—— `PgNonWorkshopMemberRepository` 对真实 PostgreSQL 的断言
 * （装配同 `project-resources-pg.test.ts`）。用例层的编排见 `non-workshop-members.test.ts`。
 *
 * ⚠ 本文件**未在本地执行**（切片规则：不起服务、不跑 PG；写好标明，CI 跑）。
 *
 * 钉住：
 *   · 按 `projects.kind` 分派：research_project 写进 `research_project_members`，user_insight 写进
 *     `user_insight_members`，互不串表；
 *   · upsert：同一人再 add 一次 = 改档（一行不变成两行）；`displayName` LEFT JOIN credentials，缺则回落 user_id；
 *   · 排序：owner 在前、再按 user_id；
 *   · 幂等删：不在名单上 ⇒ removed:false；
 *   · 归档容器：add ⇒ PROJECT_ARCHIVED（F124 RESTRICTIVE 策略 + 用例预读）；
 *   · 空 owner 时组织 lead 能加第一位，之后被收回；
 *   · 工作坊容器 ⇒ ProjectKindMismatchError；
 *   · 跨租户：另一组织同 id 的容器看不到（RLS + org_id 谓词）⇒ NO_PROJECT_ROLE。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listNonWorkshopMembers } from "../../src/application/project/list-non-workshop-member";
import { addNonWorkshopMember } from "../../src/application/project/add-non-workshop-member";
import { removeNonWorkshopMember } from "../../src/application/project/remove-non-workshop-member";
import { ProjectKindMismatchError } from "../../src/application/project/errors";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgNonWorkshopMemberRepository } from "../../src/infrastructure/project/pg-non-workshop-member-repository";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { addCredential, addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const HOOK_TIMEOUT_MS = 120_000;
const ORG = "org-b3t5-pg";
const OTHER = "org-b3t5-pg-other";
const ORG_ID = toOrgId(ORG);
const RESEARCH = `${ORG}-research`;
const INSIGHT = `${ORG}-insight`;
const WORKSHOP = `${ORG}-workshop`;
const OWNER = "u-b3t5-owner";
const COLLAB = "u-b3t5-collab";
const COLLEAGUE = "u-b3t5-colleague";
const LEAD = "u-b3t5-lead";

let db: PgDatabase;
let repo: PgNonWorkshopMemberRepository;
let provenance: FakeProvenanceWriter;
let deps: Parameters<typeof addNonWorkshopMember>[0];

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgNonWorkshopMemberRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: RESEARCH, projectKind: "research_project", groupNames: [] });
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, 'insight', 'user_insight')", [INSIGHT, ORG]);
    await c.query("INSERT INTO user_insights (id, org_id) VALUES ($1, $2)", [INSIGHT, ORG]);
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, 'ws', 'workshop')", [WORKSHOP, ORG]);
    await c.query("INSERT INTO workshops (id, org_id) VALUES ($1, $2)", [WORKSHOP, ORG]);
  });
  for (const u of [OWNER, COLLAB, COLLEAGUE]) await addOrgMember(ORG, u, "consultant", null);
  await addOrgMember(ORG, LEAD, "lead", null);
  await addCredential(OWNER, `${OWNER}@x.test`, "负责人甲");
  // 另一租户：同 id 的容器，用来证明 org_id 谓词 + RLS 生效。
  await seedOrg({ orgId: OTHER, projectId: RESEARCH, projectKind: "research_project", groupNames: [] });
  provenance = new FakeProvenanceWriter();
  deps = { identity: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), members: repo, provenance };
}, HOOK_TIMEOUT_MS);

const asUser = (actorId: string, projectId = RESEARCH) => ({ actorId, orgId: ORG_ID, projectId });

async function countRows(table: "research_project_members" | "user_insight_members", projectId: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE project_id = $1`, [projectId]);
    return Number(r.rows[0]?.n ?? 0);
  });
}

describe("PgNonWorkshopMemberRepository（真实 PG）", () => {
  it("空 owner 时组织 lead 加第一位；之后按 kind 分派到各自的表，互不串表", async () => {
    await addNonWorkshopMember(deps, { ...asUser(LEAD), userId: OWNER, role: "owner" });
    await addNonWorkshopMember(deps, { ...asUser(LEAD, INSIGHT), userId: OWNER, role: "owner" });
    expect(await countRows("research_project_members", RESEARCH)).toBe(1);
    expect(await countRows("user_insight_members", INSIGHT)).toBe(1);
    expect(await countRows("user_insight_members", RESEARCH)).toBe(0);
    expect(await countRows("research_project_members", INSIGHT)).toBe(0);
    // 有了 owner 之后，不在名单上的 lead 再加 ⇒ 收回。
    await expect(addNonWorkshopMember(deps, { ...asUser(LEAD), userId: LEAD, role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "ORG_ROLE_INSUFFICIENT",
    });
  });

  it("upsert 改档不多一行；名单 owner 在前、displayName 来自 credentials（缺则回落 user_id）", async () => {
    await addNonWorkshopMember(deps, { ...asUser(LEAD), userId: OWNER, role: "owner" });
    await addNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB, role: "collaborator" });
    await addNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB, role: "collaborator" });
    expect(await countRows("research_project_members", RESEARCH)).toBe(2);
    const out = await listNonWorkshopMembers(deps, asUser(COLLAB));
    expect(out.members).toEqual([
      { userId: OWNER, displayName: "负责人甲", role: "owner" },
      { userId: COLLAB, displayName: COLLAB, role: "collaborator" },
    ]);
    // collaborator 改成 owner：仍是 2 行，排序按 user_id。
    await addNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB, role: "owner" });
    expect(await countRows("research_project_members", RESEARCH)).toBe(2);
    const again = await listNonWorkshopMembers(deps, asUser(OWNER));
    expect(again.members.map((m) => m.role)).toEqual(["owner", "owner"]);
    expect(provenance.appended).toHaveLength(4);
  });

  it("collaborator 不能加 / 删；组织同事不在名单上读 ⇒ NO_PROJECT_ROLE", async () => {
    await addNonWorkshopMember(deps, { ...asUser(LEAD), userId: OWNER, role: "owner" });
    await addNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB, role: "collaborator" });
    await expect(addNonWorkshopMember(deps, { ...asUser(COLLAB), userId: COLLEAGUE, role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
    await expect(removeNonWorkshopMember(deps, { ...asUser(COLLAB), userId: OWNER })).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
    await expect(listNonWorkshopMembers(deps, asUser(COLLEAGUE))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("幂等删：不在名单上 ⇒ removed:false、不写审计；在名单上 ⇒ removed:true", async () => {
    await addNonWorkshopMember(deps, { ...asUser(LEAD), userId: OWNER, role: "owner" });
    await addNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB, role: "collaborator" });
    const before = provenance.appended.length;
    expect(await removeNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLEAGUE })).toMatchObject({ removed: false, provenanceEventId: null });
    expect(provenance.appended).toHaveLength(before);
    expect(await removeNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB })).toMatchObject({ removed: true });
    expect(await countRows("research_project_members", RESEARCH)).toBe(1);
  });

  it("归档容器 ⇒ PROJECT_ARCHIVED，不写", async () => {
    await addNonWorkshopMember(deps, { ...asUser(LEAD), userId: OWNER, role: "owner" });
    await asApp(ORG, (c) => c.query("UPDATE projects SET status = 'archived' WHERE id = $1", [RESEARCH]));
    await expect(addNonWorkshopMember(deps, { ...asUser(OWNER), userId: COLLAB, role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "PROJECT_ARCHIVED",
    });
    expect(await countRows("research_project_members", RESEARCH)).toBe(1);
    // 仓储层自己也能翻译 F124 的策略拒绝（不只靠用例预读）。
    const outcome = await repo.upsertMember({ orgId: ORG_ID, projectId: RESEARCH, kind: "research_project", userId: COLLAB, role: "collaborator" });
    expect(outcome.kind).toBe("archived");
  });

  it("工作坊容器 ⇒ ProjectKindMismatchError（不带码的 400）", async () => {
    await expect(listNonWorkshopMembers(deps, asUser(LEAD, WORKSHOP))).rejects.toBeInstanceOf(ProjectKindMismatchError);
    await expect(addNonWorkshopMember(deps, { ...asUser(LEAD, WORKSHOP), userId: LEAD, role: "owner" })).rejects.toBeInstanceOf(ProjectKindMismatchError);
  });

  it("跨租户：另一组织同 id 的容器与成员不可见（RLS + org_id 谓词）", async () => {
    // 另一租户里同 id 的容器有自己的 owner 行。
    await asApp(OTHER, (c) =>
      c.query("INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')", [OWNER, RESEARCH, OTHER]),
    );
    // 本租户：OWNER 在本租户的这个容器里没有行 ⇒ 读不到名单，另一租户那行不算数。
    await expect(listNonWorkshopMembers(deps, asUser(OWNER))).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    // lead 加第一位后名单只有本租户这一行。
    await addNonWorkshopMember(deps, { ...asUser(LEAD), userId: COLLAB, role: "owner" });
    const out = await listNonWorkshopMembers(deps, asUser(COLLAB));
    expect(out.members.map((m) => m.userId)).toEqual([COLLAB]);
  });
});
