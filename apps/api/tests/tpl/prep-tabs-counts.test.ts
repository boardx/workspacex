import { describe, expect, it } from "vitest";
import {
  getProjectPrepUseCase,
  GetProjectPrepError,
} from "../../src/application/templates/get-project-prep";
import type { ProjectPrepRepository } from "../../src/application/templates/project-prep-ports";
import {
  EMPTY_PROJECT_PREP_COUNTS,
  planProjectPrepTabs,
  type ProjectPrepCounts,
} from "../../src/domain/templates/project-prep";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-f24-prep");

/**
 * F24 —— **项目筹备页外壳：四子标签 + 计数**（`uc-2-2` R6/R8 V6/V15）。
 *
 * 内存假仓储持有一份可变的 `ProjectPrepCounts`，测试直接改它模拟「实际写入数据变了」，
 * 断言标签的数字与之**同步刷新**——而不是断言一份写死的固定输出,那样测不出「与实际
 * 写入数据一致」这条要求本身。
 */
class FakeProjectPrepRepository implements ProjectPrepRepository {
  private counts: ProjectPrepCounts | null;

  constructor(counts: ProjectPrepCounts | null) {
    this.counts = counts;
  }

  setCounts(counts: ProjectPrepCounts | null): void {
    this.counts = counts;
  }

  async loadCounts(_orgId: unknown, _projectId: string): Promise<ProjectPrepCounts | null> {
    return this.counts;
  }
}

describe("F24 · 项目筹备页四子标签计数", () => {
  it("四个标签恒定出现,顺序固定,即使某一类今天是 0（V15 空态）", () => {
    const tabs = planProjectPrepTabs(EMPTY_PROJECT_PREP_COUNTS);
    expect(tabs.map((t) => t.key)).toEqual(["topic-grouping", "agenda", "materials", "pre-tasks"]);
    expect(tabs.every((t) => t.count === 0)).toBe(true);
    // 空态是真实空态：不生成示例分组或示例议程（V15）——label 里的数字也必须是 0,不是编造值。
    expect(tabs.find((t) => t.key === "agenda")?.label).toBe("议程 0 环节");
    expect(tabs.find((t) => t.key === "materials")?.label).toBe("材料准备 0 份");
    expect(tabs.find((t) => t.key === "pre-tasks")?.label).toBe("会前任务 0/0");
  });

  it("label 里的数字与后端实际条目数逐一对应（V6）", () => {
    const counts: ProjectPrepCounts = {
      groupCount: 4,
      agendaSegmentCount: 7,
      materialsCount: 9,
      preTasksDone: 7,
      preTasksTotal: 12,
    };
    const tabs = planProjectPrepTabs(counts);
    expect(tabs).toEqual([
      { key: "topic-grouping", label: "定题与分组", count: 4 },
      { key: "agenda", label: "议程 7 环节", count: 7 },
      { key: "materials", label: "材料准备 9 份", count: 9 },
      { key: "pre-tasks", label: "会前任务 7/12", count: 12 },
    ]);
  });

  it("改数据后计数同步刷新——同一个用例、同一个仓储、两次不同的结果（V6）", async () => {
    const repo = new FakeProjectPrepRepository({
      groupCount: 0,
      agendaSegmentCount: 7,
      materialsCount: 0,
      preTasksDone: 0,
      preTasksTotal: 3,
    });

    const before = await getProjectPrepUseCase(
      { repo },
      { orgId: ORG, projectId: "p-1", actorProjectRole: "member" },
    );
    expect(before.tabs.find((t) => t.key === "materials")?.count).toBe(0);

    // 模拟材料准备这一类新写入了 9 条。
    repo.setCounts({
      groupCount: 4,
      agendaSegmentCount: 7,
      materialsCount: 9,
      preTasksDone: 1,
      preTasksTotal: 3,
    });

    const after = await getProjectPrepUseCase(
      { repo },
      { orgId: ORG, projectId: "p-1", actorProjectRole: "member" },
    );
    expect(after.tabs.find((t) => t.key === "materials")?.label).toBe("材料准备 9 份");
    expect(after.tabs.find((t) => t.key === "materials")?.count).toBe(9);
    expect(after.tabs.find((t) => t.key === "pre-tasks")?.label).toBe("会前任务 1/3");
  });

  it("观察者也能读筹备页（本操作只判「有没有项目角色」,不判角色够不够写）", async () => {
    const repo = new FakeProjectPrepRepository(EMPTY_PROJECT_PREP_COUNTS);
    const out = await getProjectPrepUseCase(
      { repo },
      { orgId: ORG, projectId: "p-1", actorProjectRole: "observer" },
    );
    expect(out.tabs).toHaveLength(4);
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const repo = new FakeProjectPrepRepository(EMPTY_PROJECT_PREP_COUNTS);
    await expect(
      getProjectPrepUseCase({ repo }, { orgId: ORG, projectId: "p-1", actorProjectRole: null }),
    ).rejects.toMatchObject(new GetProjectPrepError("NO_PROJECT_ROLE"));
  });

  it("项目不存在或越权可见 ⇒ 同一个 NO_PROJECT_ROLE,两者外部不可分辨", async () => {
    const repo = new FakeProjectPrepRepository(null);
    await expect(
      getProjectPrepUseCase({ repo }, { orgId: ORG, projectId: "p-ghost", actorProjectRole: "facilitator" }),
    ).rejects.toMatchObject(new GetProjectPrepError("NO_PROJECT_ROLE"));
  });

  it("仓储读取失败 ⇒ DEPENDENCY_UNAVAILABLE,不吞成空态", async () => {
    const repo: ProjectPrepRepository = {
      loadCounts: async () => {
        throw new Error("db down");
      },
    };
    await expect(
      getProjectPrepUseCase({ repo }, { orgId: ORG, projectId: "p-1", actorProjectRole: "facilitator" }),
    ).rejects.toMatchObject(new GetProjectPrepError("DEPENDENCY_UNAVAILABLE"));
  });
});
