/**
 * B2-S5（#4429）—— 设置页「AI 权限」两个用例的无库单测（假仓储 + `FakeRoleViewRepository`）。
 * 钉住：没有行 = 默认全开且 updatedAt/updatedBy 为 null / 引导师能写且写的是归一后的集合 /
 * 组员 PROJECT_ROLE_INSUFFICIENT / 非成员 NO_PROJECT_ROLE / 观察者能读 / 组织 admin 越过项目层读 ⇒ ADMIN_NOT_SUPERUSER。
 * 真库的 upsert + 回读在 `project-ai-settings-pg.test.ts`。
 */
import { describe, expect, it } from "vitest";
import { getProjectAiSettings, ALL_PROJECT_AI_SOURCES } from "../../src/application/project/get-project-ai-settings";
import { updateProjectAiSettings } from "../../src/application/project/update-project-ai-settings";
import type {
  ProjectAiSettingsRepository,
  ProjectAiSettingsRow,
  UpsertProjectAiSettingsCommand,
  UpsertProjectAiSettingsOutcome,
} from "../../src/application/project/project-ai-settings-ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-b2s5");
const PROJECT = "proj-b2s5";

class FakeAiSettingsRepo implements ProjectAiSettingsRepository {
  row: ProjectAiSettingsRow | null = null;
  upserts: UpsertProjectAiSettingsCommand[] = [];
  missingProject = false;
  async find(): Promise<Guarded<ProjectAiSettingsRow | null>> {
    return guard({ kind: "project", id: PROJECT }, this.row);
  }
  async upsert(cmd: UpsertProjectAiSettingsCommand): Promise<UpsertProjectAiSettingsOutcome> {
    if (this.missingProject) return { kind: "not-found" };
    this.upserts.push(cmd);
    this.row = { projectId: cmd.projectId, allowedSources: cmd.allowedSources, updatedBy: cmd.updatedBy, updatedAt: "2026-09-27T00:00:00.000Z" };
    return { kind: "upserted", row: this.row };
  }
}

class SeqIds implements DecisionIdFactory {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}

const identity = new FakeRoleViewRepository({
  "u-fac": { orgRole: "consultant", projectRole: "facilitator" },
  "u-member": { orgRole: "consultant", projectRole: "member" },
  "u-observer": { orgRole: "consultant", projectRole: "observer" },
  "u-org-only": { orgRole: "consultant", projectRole: null },
  "u-admin-outside": { orgRole: "admin", projectRole: null },
  "u-lead-outside": { orgRole: "lead", projectRole: null },
});

const read = (repo: ProjectAiSettingsRepository, userId: string) =>
  getProjectAiSettings({ repo, auth: { repo: identity, ids: new SeqIds() } }, { userId, orgId: ORG, projectId: PROJECT });

describe("getProjectAiSettings：读门 + 默认值", () => {
  it("没有行 ⇒ allowedSources 是契约枚举全集，updatedAt / updatedBy 为 null", async () => {
    const out = await read(new FakeAiSettingsRepo(), "u-fac");
    expect(out).toEqual({
      projectId: PROJECT,
      allowedSources: ["chat", "whiteboard", "transcript", "survey", "interview", "research"],
      updatedAt: null,
      updatedBy: null,
    });
    expect(out.allowedSources).toEqual(ALL_PROJECT_AI_SOURCES);
  });

  it("观察者能读（read.published 是四种角色都带的动作）", async () => {
    const repo = new FakeAiSettingsRepo();
    repo.row = { projectId: PROJECT, allowedSources: ["chat"], updatedBy: "u-fac", updatedAt: "2026-09-27T00:00:00.000Z" };
    await expect(read(repo, "u-observer")).resolves.toMatchObject({ allowedSources: ["chat"], updatedBy: "u-fac" });
  });

  it("非成员 ⇒ NO_PROJECT_ROLE；组织 admin 越过项目层 ⇒ ADMIN_NOT_SUPERUSER（分层透传）", async () => {
    await expect(read(new FakeAiSettingsRepo(), "u-org-only")).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(read(new FakeAiSettingsRepo(), "u-nobody")).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(read(new FakeAiSettingsRepo(), "u-admin-outside")).rejects.toMatchObject({ reasonCode: "ADMIN_NOT_SUPERUSER" });
  });

  it("判定服务抛错 ⇒ AUTH_SERVICE_UNAVAILABLE，不降级放行", async () => {
    const broken = new Proxy(identity, {
      get: (t, k) => (k === "findOrgMembership" ? async () => { throw new Error("pg down"); } : Reflect.get(t, k)),
    });
    await expect(
      getProjectAiSettings({ repo: new FakeAiSettingsRepo(), auth: { repo: broken, ids: new SeqIds() } }, { userId: "u-fac", orgId: ORG, projectId: PROJECT }),
    ).rejects.toMatchObject({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" });
  });
});

const write = (repo: ProjectAiSettingsRepository, actorId: string, allowedSources: UpsertProjectAiSettingsCommand["allowedSources"]) =>
  updateProjectAiSettings({ repo, identity }, { actorId, orgId: ORG, projectId: PROJECT, allowedSources });

describe("updateProjectAiSettings：写门 = authorizeManageMembers", () => {
  it("引导师能写：落库的是去重 + 按枚举顺序归一后的集合，回显带 updatedBy = 自己", async () => {
    const repo = new FakeAiSettingsRepo();
    const out = await write(repo, "u-fac", ["research", "chat", "chat"]);
    expect(repo.upserts).toHaveLength(1);
    expect(repo.upserts[0]).toMatchObject({ projectId: PROJECT, allowedSources: ["chat", "research"], updatedBy: "u-fac" });
    expect(out).toMatchObject({ projectId: PROJECT, allowedSources: ["chat", "research"], updatedBy: "u-fac" });
    expect(out.updatedAt).not.toBeNull();
    // 写完再读，读到的就是刚写的。
    await expect(read(repo, "u-member")).resolves.toMatchObject({ allowedSources: ["chat", "research"] });
  });

  it("空数组是合法值（全部关掉）", async () => {
    const repo = new FakeAiSettingsRepo();
    await expect(write(repo, "u-fac", [])).resolves.toMatchObject({ allowedSources: [] });
  });

  it("组员 ⇒ PROJECT_ROLE_INSUFFICIENT，仓储没被碰", async () => {
    const repo = new FakeAiSettingsRepo();
    await expect(write(repo, "u-member", ["chat"])).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    expect(repo.upserts).toHaveLength(0);
  });

  it("非成员且无组织身份 ⇒ NO_PROJECT_ROLE；组织 consultant 无项目角色 ⇒ ORG_ROLE_INSUFFICIENT", async () => {
    await expect(write(new FakeAiSettingsRepo(), "u-nobody", ["chat"])).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    await expect(write(new FakeAiSettingsRepo(), "u-org-only", ["chat"])).rejects.toMatchObject({ reasonCode: "ORG_ROLE_INSUFFICIENT" });
  });

  it("组织 lead / admin 无项目角色也能写（路径②）；容器不存在 ⇒ NO_PROJECT_ROLE", async () => {
    await expect(write(new FakeAiSettingsRepo(), "u-lead-outside", ["survey"])).resolves.toMatchObject({ allowedSources: ["survey"] });
    await expect(write(new FakeAiSettingsRepo(), "u-admin-outside", ["survey"])).resolves.toMatchObject({ allowedSources: ["survey"] });
    const missing = new FakeAiSettingsRepo();
    missing.missingProject = true;
    await expect(write(missing, "u-admin-outside", ["survey"])).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});
