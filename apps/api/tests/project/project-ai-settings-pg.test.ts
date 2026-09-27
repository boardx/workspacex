/**
 * B2-S5（#4429）—— `PgProjectAiSettingsRepository` 真库：upsert + 回读（同一行被第二次写覆盖）、
 * 没有行时默认全开、RLS 下别的组织读不到、不存在的容器报 not-found。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProjectAiSettingsRepository } from "../../src/infrastructure/project/pg-project-ai-settings-repository";
import { getProjectAiSettings } from "../../src/application/project/get-project-ai-settings";
import { updateProjectAiSettings } from "../../src/application/project/update-project-ai-settings";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-b2s5-pg";
const OTHER_ORG = "org-b2s5-pg-other";
const PROJECT = "proj-b2s5-pg";
const FACILITATOR = "u-b2s5-fac";
const MEMBER = "u-b2s5-member";

class SeqIds implements DecisionIdFactory {
  private n = 0;
  next(): string { return `d-b2s5-${++this.n}`; }
}

let db: PgDatabase;
let repo: PgProjectAiSettingsRepository;
let identity: PgIdentityRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProjectAiSettingsRepository(db);
  identity = new PgIdentityRepository(db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await db?.close();
}, 120_000);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: "proj-b2s5-pg-other" });
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, FACILITATOR, "facilitator", null, true);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null);
});

const auth = () => ({ repo: identity, ids: new SeqIds() });
const readAs = (userId: string) =>
  getProjectAiSettings({ repo, auth: auth() }, { userId, orgId: toOrgId(ORG), projectId: PROJECT });

describe("PgProjectAiSettingsRepository", () => {
  it("没有行 ⇒ 默认全开、updatedAt/updatedBy 为 null", async () => {
    await expect(readAs(MEMBER)).resolves.toEqual({
      projectId: PROJECT,
      allowedSources: ["chat", "transcript", "survey", "interview", "research"],
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("upsert 两次：第二次覆盖第一次，回读的是最后一次写的归一集合与 updatedBy", async () => {
    const first = await updateProjectAiSettings(
      { repo, identity },
      { actorId: FACILITATOR, orgId: toOrgId(ORG), projectId: PROJECT, allowedSources: ["research", "chat"] },
    );
    expect(first).toMatchObject({ allowedSources: ["chat", "research"], updatedBy: FACILITATOR });
    expect(first.updatedAt).not.toBeNull();

    const second = await updateProjectAiSettings(
      { repo, identity },
      { actorId: FACILITATOR, orgId: toOrgId(ORG), projectId: PROJECT, allowedSources: ["survey"] },
    );
    expect(second.allowedSources).toEqual(["survey"]);

    const back = await readAs(MEMBER);
    expect(back).toMatchObject({ allowedSources: ["survey"], updatedBy: FACILITATOR });
    expect(back.updatedAt).toBe(second.updatedAt);

    // 侧表恰好一行——upsert 不是 append。
    const n = await db.withTenant(toOrgId(ORG), (s) =>
      s.query<{ n: string }>(`SELECT count(*)::text AS n FROM project_ai_settings WHERE project_id = $1`, [PROJECT]),
    );
    expect(n.rows[0]?.n).toBe("1");
  });

  it("组员写 ⇒ PROJECT_ROLE_INSUFFICIENT；行没有被建出来", async () => {
    await expect(
      updateProjectAiSettings({ repo, identity }, { actorId: MEMBER, orgId: toOrgId(ORG), projectId: PROJECT, allowedSources: [] }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(readAs(MEMBER)).resolves.toMatchObject({ updatedAt: null });
  });

  it("RLS：另一个组织的租户会话读不到这一行（guard 载荷为 null）", async () => {
    await repo.upsert({ orgId: toOrgId(ORG), projectId: PROJECT, allowedSources: ["chat"], updatedBy: FACILITATOR });
    const guarded = await repo.find(toOrgId(OTHER_ORG), PROJECT);
    const d = discloseDecided(guarded, {
      allowed: true, reasonCode: null, decisionId: "d-test", orgLayer: { role: "consultant", teamId: null, passed: true },
      projectLayer: null, scopeLayer: { scope: "org-wide", passed: true },
    });
    expect(isDisclosed(d) && d.payload).toBeNull();
  });

  it("不存在的容器 ⇒ not-found（不是 23503 变 500）", async () => {
    await expect(
      repo.upsert({ orgId: toOrgId(ORG), projectId: "proj-b2s5-nope", allowedSources: ["chat"], updatedBy: FACILITATOR }),
    ).resolves.toEqual({ kind: "not-found" });
  });
});
