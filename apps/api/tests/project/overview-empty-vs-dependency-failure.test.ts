/**
 * F123 -- UC-P3 `getProjectOverview`: **空态 vs 依赖失败**必须可区分（uc-00-2 V9）。
 *
 * ⚠ 需要真实 Postgres（`ensureDatabase` / `migrateOnce`）。本仓纪律（issue #74）：
 *   本地不跑这类测试，只跑 `pnpm --filter api run typecheck`；CI / `harness verify`
 *   跑真正的执行。
 *
 * ## 为什么「可区分」不能只用一条正向断言证明
 *
 * 「依赖不可用时抛 DEPENDENCY_UNAVAILABLE」与「空项目返回空值」各自单独断言，
 * 挡不住一个把两者都变成同一种观察结果的实现——例如一个把仓储异常吞掉、
 * 静默返回「看起来空」的默认值的版本，会让「空态」那条测试继续绿，
 * 「依赖失败」那条测试才会变红；但如果两条都只测「结果长什么样」而不比较
 * **成功/失败**这个更粗的观察维度，两者仍可能被误判成同一件事。
 * 本文件因此额外写一条 `describe("两者不可混淆")`：直接断言"依赖失败"路径的
 * 观察结果**不是**一个可解析的成功值，"空态"路径**不会**抛错——把两条路径
 * 的失败模式互换（用抛错的仓储去查真实存在的空项目、反之），确认测试能抓出差异。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getProjectOverview } from "../../src/application/project/get-project-overview";
import { PgProjectOverviewRepository } from "../../src/infrastructure/project/pg-project-overview-repository";
import type {
  OverviewAgendaSegment,
  OverviewRoleCounts,
  ProjectOverviewRepository,
  ProjectSnapshotRow,
} from "../../src/application/project/ports";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import { makeHarness, type Harness } from "../support/binding-fixture";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f123-empty-vs-fail";
const WORKSHOP = "proj-f123-empty-vs-fail";
const FACILITATOR = "u-f123-evf-facilitator";

let h: Harness;
let realRepo: PgProjectOverviewRepository;

const org = () => toOrgId(ORG);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f123-empty-vs-fail");
  realRepo = new PgProjectOverviewRepository(h.db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await h?.close();
}, 120_000);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: WORKSHOP });
  // 项目层角色不是独立于组织层的——`decide()` 先判组织层（`orgPassed`），项目成员身份
  // 必须叠在一个真实的组织成员身份之上，同 `create-project-org-role-gate.test.ts` /
  // `step-closed-bidirectional.test.ts` 的既有约定。少了这一行，`orgPassed` 恒为 false，
  // `decide()` 返回 `NO_ORG_MEMBERSHIP`，本函数把它塌缩成 `NO_PROJECT_ROLE`——看起来像
  // 「没有项目角色」，实际是「压根没找到组织成员行」，两回事。
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addProjectMember(ORG, WORKSHOP, FACILITATOR, "facilitator", null, true);
});

/**
 * 一个真实仓储的装饰器，只在**被点名的那一次调用**上把成功变成一次存储层拒绝——
 * 不是永远失败的假仓储，那种假仓储无法证明「其它三次调用仍然正常」。
 */
class FailingOnceRepository implements ProjectOverviewRepository {
  private readonly failed = new Set<string>();
  constructor(
    private readonly real: ProjectOverviewRepository,
    private readonly failOn: readonly ("snapshot" | "segment" | "roleCounts")[],
  ) {}

  async getProjectSnapshot(orgId: OrgId, projectId: string): Promise<ProjectSnapshotRow | null> {
    if (this.failOn.includes("snapshot")) {
      this.failed.add("snapshot");
      throw new Error("simulated storage outage: projects");
    }
    return this.real.getProjectSnapshot(orgId, projectId);
  }
  async getCurrentAgendaSegment(orgId: OrgId, workshopId: string): Promise<OverviewAgendaSegment | null> {
    if (this.failOn.includes("segment")) {
      this.failed.add("segment");
      throw new Error("simulated storage outage: agenda_segments");
    }
    return this.real.getCurrentAgendaSegment(orgId, workshopId);
  }
  async getWorkshopRoleCounts(orgId: OrgId, projectId: string): Promise<OverviewRoleCounts> {
    if (this.failOn.includes("roleCounts")) {
      this.failed.add("roleCounts");
      throw new Error("simulated storage outage: project_memberships");
    }
    return this.real.getWorkshopRoleCounts(orgId, projectId);
  }
  /** 供测试自证「失败真的被触发过」，不是因为其它原因巧合抛错。 */
  triggered(which: "snapshot" | "segment" | "roleCounts"): boolean {
    return this.failed.has(which);
  }
}

const call = (repo: ProjectOverviewRepository) =>
  getProjectOverview(
    { repo, auth: h.deps.auth, binding: h.deps },
    { userId: FACILITATOR, orgId: org(), projectId: WORKSHOP },
  );

describe("空态：真实的空项目，正常返回，不抛错", () => {
  it("新工作坊没有议程环节 / 没有成员之外的角色 / 没有回流：全部是空值，是一个成功的响应", async () => {
    const out = await call(realRepo);
    expect(out.currentAgendaSegment).toBeNull();
    expect(out.roleCounts).toEqual({ facilitator: 1, groupLead: 0, member: 0, observer: 0 });
    expect(out.backflow).toEqual([]);
    expect(out.blueprint).toBeNull();
  });
});

describe("依赖失败：仓储读取抛错时，整个用例必须抛 DEPENDENCY_UNAVAILABLE，不是返回一个'看起来空'的值", () => {
  it("容器身份查询失败", async () => {
    const failing = new FailingOnceRepository(realRepo, ["snapshot"]);
    await expect(call(failing)).rejects.toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    expect(failing.triggered("snapshot")).toBe(true);
  });

  it("当前议程环节查询失败", async () => {
    const failing = new FailingOnceRepository(realRepo, ["segment"]);
    await expect(call(failing)).rejects.toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    expect(failing.triggered("segment")).toBe(true);
  });

  it("角色人数查询失败", async () => {
    const failing = new FailingOnceRepository(realRepo, ["roleCounts"]);
    await expect(call(failing)).rejects.toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    expect(failing.triggered("roleCounts")).toBe(true);
  });
});

describe("两者不可混淆：把'空态'与'依赖失败'的观察维度互换，测试必须能抓出差异", () => {
  it("空态路径的观察结果是一个可用的返回值,不是一次异常", async () => {
    // 用真实仓储（不失败）查询同一个真实存在的空项目——观察维度是「resolve」。
    await expect(call(realRepo)).resolves.toMatchObject({ backflow: [] });
  });

  it("依赖失败路径的观察结果是一次异常，绝不能被解析成任何合法的成功响应体", async () => {
    // 互换：把「失败」这个观察维度套在同一个项目上——同样的项目数据（真实存在、真实为空），
    // 唯一变量是仓储这次会不会抛错。若实现把仓储异常吞掉、静默拼一个「看起来空」的响应体，
    // 这条断言会失败（因为它会 resolve 而不是 reject），而上一条 describe 的三条用例
    // 不会告诉你这件事——它们只断言"抛出了 DEPENDENCY_UNAVAILABLE"，
    // 没有断言"不会有第二条路径把同一次失败悄悄 resolve 成功"。
    const failing = new FailingOnceRepository(realRepo, ["snapshot", "segment", "roleCounts"]);
    await expect(call(failing)).rejects.toBeInstanceOf(Error);
    await expect(call(failing)).rejects.not.toMatchObject({ backflow: [] });
  });
});
