/**
 * #4615 W2 —— `kg_adopt_project_decision` 的成员判定对通用项目开放（迁移 20260929110100）。真实 PostgreSQL。
 *
 * ⚠ 本文件在提交时**未在本地执行**（本切片不跑 PG；见回报）。依赖 W1 容器迁移：`projects.kind = 'general'`、
 *   `general_projects` / `general_project_members`（由 research_project_* 更名而来，列形状同 F128）。
 *
 * 只钉数据库函数的**成员门**（门在读来源之前）：用一个不存在的 claim id 直接调函数——
 *   · 通用项目负责人 / 协作者：过了成员门，落到 KG_CLAIM_NOT_FOUND（证明门放行）；
 *   · 名单外的组织 lead：observer ⇒ KG_NOT_OWNER；
 *   · 名单外的顾问：KG_NOT_VISIBLE；
 *   · 工作坊行为不变：工作坊观察者 KG_NOT_OWNER、工作坊成员过门。
 * 采纳本身（复制条目 / 证据 / 审计）与工作坊同一段 SQL，由 adopt-project-decision.test.ts 覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-4615-w2-adopt";
const ORG_ID = toOrgId(ORG);
const WORKSHOP = `${ORG}-ws`;
const GENERAL = `${ORG}-general`;
let db: PgDatabase;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: WORKSHOP });
  for (const u of ["u-owner", "u-collab", "u-out", "u-ws-mem", "u-ws-obs"]) await addOrgMember(ORG, u, "consultant", null);
  await addOrgMember(ORG, "u-lead", "lead", null);
  await addProjectMember(ORG, WORKSHOP, "u-ws-mem", "member", null);
  await addProjectMember(ORG, WORKSHOP, "u-ws-obs", "observer", null);
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, '通用项目', 'general')", [GENERAL, ORG]);
    await c.query("INSERT INTO general_projects (id, org_id) VALUES ($1, $2)", [GENERAL, ORG]);
    await c.query(
      "INSERT INTO general_project_members (user_id, project_id, org_id, role) VALUES ('u-owner', $1, $2, 'owner'), ('u-collab', $1, $2, 'collaborator')",
      [GENERAL, ORG],
    );
  });
  db = new PgDatabase(appConfig());
}, 120_000);
afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
}, 120_000);

const direct = (userId: string, projectId: string) => db.withTenant(ORG_ID, async (s) => {
  await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
  await s.query("SELECT kg_adopt_project_decision($1::jsonb)", [
    JSON.stringify({ action_id: newKgId("act"), project_id: projectId, claim_id: "no-such-claim", rationale: "理由" }),
  ]);
});

describe("kg_adopt_project_decision：通用项目的成员门", () => {
  it("负责人 / 协作者过门（落到 KG_CLAIM_NOT_FOUND）", async () => {
    await expect(direct("u-owner", GENERAL)).rejects.toThrow(/^KG_CLAIM_NOT_FOUND/);
    await expect(direct("u-collab", GENERAL)).rejects.toThrow(/^KG_CLAIM_NOT_FOUND/);
  });
  it("名单外的组织 lead ⇒ KG_NOT_OWNER；名单外顾问 ⇒ KG_NOT_VISIBLE", async () => {
    await expect(direct("u-lead", GENERAL)).rejects.toThrow(/^KG_NOT_OWNER/);
    await expect(direct("u-out", GENERAL)).rejects.toThrow(/^KG_NOT_VISIBLE/);
  });
  it("工作坊不变：成员过门、观察者 KG_NOT_OWNER、通用项目名单上的人在工作坊里仍不是成员", async () => {
    await expect(direct("u-ws-mem", WORKSHOP)).rejects.toThrow(/^KG_CLAIM_NOT_FOUND/);
    await expect(direct("u-ws-obs", WORKSHOP)).rejects.toThrow(/^KG_NOT_OWNER/);
    await expect(direct("u-collab", WORKSHOP)).rejects.toThrow(/^KG_NOT_VISIBLE/);
  });
});
