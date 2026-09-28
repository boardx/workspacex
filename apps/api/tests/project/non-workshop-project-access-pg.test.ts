/**
 * #4584 —— 研究项目 / 用户洞察的负责人、协作者经 `authorize()` 打开项目工作台，对真实 PostgreSQL 断言：
 * `PgIdentityRepository.findNonWorkshopStanding` 按 `projects.kind` 分派两张成员表，`authorize()` 的项目层
 * 读到它（`application/identity/project-layer.ts`）。编排与映射的无库断言在 `non-workshop-project-access.test.ts`。
 *
 * ⚠ 本文件**未在本地执行**（切片规则：不起服务、不跑 PG；写好标明，CI 跑）。
 *
 * 钉住：
 *   · findNonWorkshopStanding：research_project / user_insight 各读各的表、互不串表；工作坊 ⇒ null；
 *     不存在 ⇒ null；另一租户的容器 ⇒ null（`projects.id` 全局主键，另一租户用它自己的 id）；
 *   · getProjectOverview：负责人、协作者能读（此前 NO_PROJECT_ROLE）；名单外组织顾问 NO_PROJECT_ROLE；
 *   · listProjectEvidence：负责人、协作者看到完整证据；名单外顾问 NO_PROJECT_ROLE；名单外组织 lead 按只读行
 *     读到脱敏证据（说话人置空）；
 *   · 名单在另一个容器 / 另一个租户里不算数；
 *   · 工作坊专属动作（agendaSegment.advance）对负责人仍 PROJECT_ROLE_INSUFFICIENT；
 *   · 经 `createProject` 建出的研究项目：创建者由 `PgProjectRepository.create` 同事务写成 owner
 *     （2026-08-16 裁决），因此他以负责人身份（facilitator 行）打开自己的项目、能改配置；名单外顾问仍拒。
 *
 * ⚠ 上面几组的容器是直接 INSERT 的（不经 `createProject`），所以名单里只有 beforeEach 写的那几行，
 *   没有「创建者自动 owner」那一行——那一条单独由最后一组经真实 `createProject` 断言。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authorize } from "../../src/application/identity/authorize";
import { createProject } from "../../src/application/project/create-project";
import { getProjectOverview } from "../../src/application/project/get-project-overview";
import { listProjectEvidence } from "../../src/application/project/list-project-evidence";
import { toOrgId } from "../../src/domain/org-id";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgProjectEvidenceRepository } from "../../src/infrastructure/project/pg-project-evidence-repository";
import { PgProjectOverviewRepository } from "../../src/infrastructure/project/pg-project-overview-repository";
import { makeHarness, type Harness } from "../support/binding-fixture";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const HOOK_TIMEOUT_MS = 120_000;
const ORG = "org-4584-pg";
const OTHER = "org-4584-pg-other";
const ORG_ID = toOrgId(ORG);
const RESEARCH = `${ORG}-research`;
const INSIGHT = `${ORG}-insight`;
const WORKSHOP = `${ORG}-workshop`;
// projects.id 是全局主键：另一租户不能复用同一个 id，给它自己的容器。
const OTHER_RESEARCH = `${OTHER}-research`;
const OWNER = "u-4584-owner";
const COLLAB = "u-4584-collab";
const CONSULTANT = "u-4584-consultant";
const LEAD = "u-4584-lead";

let h: Harness;
let identity: PgIdentityRepository;
let overviewRepo: PgProjectOverviewRepository;
let evidenceRepo: PgProjectEvidenceRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("4584-nonworkshop");
  identity = new PgIdentityRepository(h.db);
  overviewRepo = new PgProjectOverviewRepository(h.db);
  evidenceRepo = new PgProjectEvidenceRepository(h.db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
  await h?.close();
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
  for (const u of [OWNER, COLLAB, CONSULTANT]) await addOrgMember(ORG, u, "consultant", null);
  await addOrgMember(ORG, LEAD, "lead", null);
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')", [OWNER, RESEARCH, ORG]);
    await c.query("INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'collaborator')", [COLLAB, RESEARCH, ORG]);
    // INSIGHT 的名单与 RESEARCH 相反：COLLAB 是负责人、OWNER 不在名单上——证明两张表互不串。
    await c.query("INSERT INTO user_insight_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')", [COLLAB, INSIGHT, ORG]);
  });
  // 另一租户：它自己的容器，CONSULTANT 在它的名单上是负责人——这一行在 ORG 里不能算数。
  await seedOrg({ orgId: OTHER, projectId: OTHER_RESEARCH, projectKind: "research_project", groupNames: [] });
  await addOrgMember(OTHER, CONSULTANT, "consultant", null);
  await asApp(OTHER, (c) =>
    c.query("INSERT INTO research_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')", [CONSULTANT, OTHER_RESEARCH, OTHER]),
  );
  await evidenceRepo.upsert({
    orgId: ORG_ID, projectId: RESEARCH, sourceKind: "interview_segment", resourceId: "itv-1", sourceRef: "seg-4584-1",
    excerpt: "受访者说：我们每周都要手工对账。", locator: {}, speakerLabel: "受访者 A", resourceTitle: "访谈一",
  });
}, HOOK_TIMEOUT_MS);

const auth = () => ({ repo: identity, ids: new CountingDecisionIdFactory() });

describe("PgIdentityRepository.findNonWorkshopStanding（真实 PG）", () => {
  it("按 kind 分派两张成员表，互不串；名单外 ⇒ memberRole null", async () => {
    expect(await identity.findNonWorkshopStanding(OWNER, RESEARCH, ORG_ID)).toEqual({ containerKind: "research_project", memberRole: "owner" });
    expect(await identity.findNonWorkshopStanding(COLLAB, RESEARCH, ORG_ID)).toEqual({ containerKind: "research_project", memberRole: "collaborator" });
    expect(await identity.findNonWorkshopStanding(COLLAB, INSIGHT, ORG_ID)).toEqual({ containerKind: "user_insight", memberRole: "owner" });
    expect(await identity.findNonWorkshopStanding(OWNER, INSIGHT, ORG_ID)).toEqual({ containerKind: "user_insight", memberRole: null });
    expect(await identity.findNonWorkshopStanding(CONSULTANT, RESEARCH, ORG_ID)).toEqual({ containerKind: "research_project", memberRole: null });
  });

  it("工作坊 / 不存在 / 另一租户的容器 ⇒ null", async () => {
    expect(await identity.findNonWorkshopStanding(OWNER, WORKSHOP, ORG_ID)).toBeNull();
    expect(await identity.findNonWorkshopStanding(OWNER, `${ORG}-missing`, ORG_ID)).toBeNull();
    expect(await identity.findNonWorkshopStanding(CONSULTANT, OTHER_RESEARCH, ORG_ID)).toBeNull();
  });
});

describe("getProjectOverview（工作台入口，#4584 的现象）", () => {
  const overviewOf = (userId: string, projectId = RESEARCH) =>
    getProjectOverview({ repo: overviewRepo, auth: auth(), binding: { ...h.deps, auth: auth() } }, { userId, orgId: ORG_ID, projectId });

  it("负责人、协作者能打开（此前 NO_PROJECT_ROLE）；两字段按非工作坊恒 null", async () => {
    for (const u of [OWNER, COLLAB]) {
      const out = await overviewOf(u);
      expect(out).toMatchObject({ projectId: RESEARCH, kind: "research_project", currentAgendaSegment: null, roleCounts: null });
    }
    await expect(overviewOf(COLLAB, INSIGHT)).resolves.toMatchObject({ kind: "user_insight" });
  });

  it("名单外组织顾问 NO_PROJECT_ROLE；另一租户名单上的负责人在这里也不算数", async () => {
    await expect(overviewOf(CONSULTANT)).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(overviewOf(OWNER, INSIGHT)).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});

describe("listProjectEvidence（研究 → 来源）", () => {
  const evidenceOf = (userId: string) =>
    listProjectEvidence({ auth: auth(), evidence: evidenceRepo }, { userId, orgId: ORG_ID, projectId: RESEARCH });

  it("负责人、协作者看到完整证据", async () => {
    for (const u of [OWNER, COLLAB]) {
      const page = await evidenceOf(u);
      expect(page.items.map((i) => [i.sourceRef, i.speakerLabel])).toEqual([["seg-4584-1", "受访者 A"]]);
    }
  });

  it("名单外组织顾问 NO_PROJECT_ROLE；名单外组织 lead 只读、证据脱敏（说话人置空）", async () => {
    await expect(evidenceOf(CONSULTANT)).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    const page = await evidenceOf(LEAD);
    expect(page.items[0]?.speakerLabel).toBeNull();
  });
});

describe("工作坊专属机制对两类容器仍关", () => {
  it("负责人推进议程环节 ⇒ PROJECT_ROLE_INSUFFICIENT（容器白名单）", async () => {
    const d = await authorize(auth(), {
      userId: OWNER, orgId: ORG_ID, projectId: RESEARCH, object: { kind: "project", id: RESEARCH }, action: "agendaSegment.advance",
    });
    expect(d).toMatchObject({ allowed: false, reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });
});

describe("经 createProject 建出的研究项目：创建者即负责人", () => {
  it("组织 lead 建研究项目 ⇒ 名单上是 owner，以 facilitator 行判权（能改配置，不是只读的 observer 行）", async () => {
    const created = await createProject(
      { repo: new PgProjectRepository(h.db, new UuidIdFactory()), identity },
      { orgId: ORG_ID, actorId: LEAD, name: "#4584 新研究项目", kind: "research_project", blueprintVersionId: null },
    );
    expect(await identity.findNonWorkshopStanding(LEAD, created.id, ORG_ID)).toEqual({ containerKind: "research_project", memberRole: "owner" });
    const d = await authorize(auth(), {
      userId: LEAD, orgId: ORG_ID, projectId: created.id, object: { kind: "project", id: created.id }, action: "settings.manage",
    });
    expect(d.allowed).toBe(true);
    expect(d.projectLayer?.role).toBe("facilitator");
    await expect(
      getProjectOverview({ repo: overviewRepo, auth: auth(), binding: { ...h.deps, auth: auth() } }, { userId: CONSULTANT, orgId: ORG_ID, projectId: created.id }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});
