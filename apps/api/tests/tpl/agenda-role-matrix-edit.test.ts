import { describe, expect, it } from "vitest";
import {
  updateMatrixCell,
  UpdateMatrixCellError,
} from "../../src/application/templates/update-matrix-cell";
import {
  ORCHESTRATION_ROLE_KEYS,
  isOrchestrationRoleKey,
} from "../../src/domain/templates/workflow-orchestration";
import type { OrchestrationRepository } from "../../src/application/templates/workflow-orchestration-ports";
import type { WorkflowOrchestrationSnapshot } from "../../src/domain/templates/workflow-orchestration";

/**
 * F26 —— 议程环节 × 三角色编排矩阵：编辑一格（`uc-2-2` R7 / 契约 `updateMatrixCell`）。
 *
 * ⚠ 字段名写全 `agendaSegmentId`（D-03a）。
 * ⚠ 矩阵列集由角色表**派生**，不硬编码（I-28）：断言列集 = 角色表过滤「非只读」后的
 *   子集（`observer` 没有任何写动作 ⇒ 不入列），而不是写死 `["facilitator","groupLead","member"]`。
 */

class FakeOrchestrationRepository implements OrchestrationRepository {
  store = new Map<string, WorkflowOrchestrationSnapshot>();
  upsertCalls: { projectId: string; cellId: string; expectedRevision: string }[] = [];
  /** 测试可配置：下一次 upsertCell 是否命中乐观并发失败 */
  forceVersionMismatch = false;

  async load(projectId: string) {
    return this.store.get(projectId) ?? null;
  }
  async replace() {
    throw new Error("not used in this test file");
  }
  async upsertCell(
    projectId: string,
    cell: WorkflowOrchestrationSnapshot["matrix"][number],
    expectedRevision: string,
  ) {
    this.upsertCalls.push({ projectId, cellId: cell.cellId, expectedRevision });
    if (this.forceVersionMismatch) return { ok: false as const };
    const current = this.store.get(projectId);
    if (current !== undefined) {
      const key = (c: { agendaSegmentId: string; roleKey: string }) => `${c.agendaSegmentId}/${c.roleKey}`;
      const rest = current.matrix.filter((c) => key(c) !== key(cell));
      this.store.set(projectId, { ...current, matrix: [...rest, cell], revision: "rev-2" });
    }
    return { ok: true as const, revision: "rev-2" };
  }
}

const BASE_SNAPSHOT: WorkflowOrchestrationSnapshot = {
  template: { templateId: "tpl-1", name: "设计思维标准五步", sourceVersion: 2 },
  segments: [{ agendaSegmentId: "seg-1", title: "共情", addedBy: null, optional: false }],
  matrix: [],
  revision: "rev-1",
};

describe("矩阵列集：由角色表派生（O-03/I-28）", () => {
  it("列集恰是「非只读」的角色子集：facilitator / groupLead / member，不含 observer", () => {
    expect([...ORCHESTRATION_ROLE_KEYS].sort()).toEqual(["facilitator", "groupLead", "member"]);
  });

  it("observer 不是已知列", () => {
    expect(isOrchestrationRoleKey("observer")).toBe(false);
  });

  it("未知角色字面量一律拒绝", () => {
    expect(isOrchestrationRoleKey("co-facilitator")).toBe(false);
    expect(isOrchestrationRoleKey("")).toBe(false);
  });
});

describe("updateMatrixCell", () => {
  function makeRepo() {
    const repo = new FakeOrchestrationRepository();
    repo.store.set("proj-1", BASE_SNAPSHOT);
    return repo;
  }

  it("无项目角色 ⇒ NO_PROJECT_ROLE，不触碰仓储", async () => {
    const orchestrations = makeRepo();
    await expect(
      updateMatrixCell(
        { orchestrations },
        {
          projectId: "proj-1",
          cellId: "cell-1",
          agendaSegmentId: "seg-1",
          roleKey: "facilitator",
          content: "开场",
          canvasTemplateId: null,
          skillIds: [],
          expectedRevision: "rev-1",
          actorProjectRole: null,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    expect(orchestrations.upsertCalls).toHaveLength(0);
  });

  it("observer 只读 ⇒ ROLE_INSUFFICIENT", async () => {
    const orchestrations = makeRepo();
    await expect(
      updateMatrixCell(
        { orchestrations },
        {
          projectId: "proj-1",
          cellId: "cell-1",
          agendaSegmentId: "seg-1",
          roleKey: "member",
          content: "投票",
          canvasTemplateId: null,
          skillIds: [],
          expectedRevision: "rev-1",
          actorProjectRole: "observer",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
    expect(orchestrations.upsertCalls).toHaveLength(0);
  });

  it("roleKey 不在角色表派生的列集内 ⇒ UNKNOWN_ROLE_KEY，先于任何存储层调用", async () => {
    const orchestrations = makeRepo();
    await expect(
      updateMatrixCell(
        { orchestrations },
        {
          projectId: "proj-1",
          cellId: "cell-1",
          agendaSegmentId: "seg-1",
          roleKey: "observer",
          content: "旁听",
          canvasTemplateId: null,
          skillIds: [],
          expectedRevision: "rev-1",
          actorProjectRole: "facilitator",
        },
      ),
    ).rejects.toBeInstanceOf(UpdateMatrixCellError);
    expect(orchestrations.upsertCalls).toHaveLength(0);
  });

  it("facilitator 可写；成功后 syncedTaskIds 恒为空（F27 尚未接入同步）", async () => {
    const orchestrations = makeRepo();
    const out = await updateMatrixCell(
      { orchestrations },
      {
        projectId: "proj-1",
        cellId: "cell-1",
        agendaSegmentId: "seg-1",
        roleKey: "facilitator",
        content: "开场引导 + hmw",
        canvasTemplateId: "tpl-hmw",
        skillIds: ["skill-voice-to-note"],
        expectedRevision: "rev-1",
        actorProjectRole: "facilitator",
      },
    );
    expect(out).toEqual({ cellId: "cell-1", syncedTaskIds: [] });
    const saved = await orchestrations.load("proj-1");
    expect(saved?.matrix).toHaveLength(1);
    expect(saved?.matrix[0]).toMatchObject({
      agendaSegmentId: "seg-1",
      roleKey: "facilitator",
      content: "开场引导 + hmw",
      canvasTemplateId: "tpl-hmw",
      skillIds: ["skill-voice-to-note"],
    });
  });

  it("groupLead / member 也持有写权限（「调用者对该项目有写权限」不是 facilitator 独占）", async () => {
    for (const role of ["groupLead", "member"] as const) {
      const orchestrations = makeRepo();
      const out = await updateMatrixCell(
        { orchestrations },
        {
          projectId: "proj-1",
          cellId: `cell-${role}`,
          agendaSegmentId: "seg-1",
          roleKey: role,
          content: "分工内容",
          canvasTemplateId: null,
          skillIds: [],
          expectedRevision: "rev-1",
          actorProjectRole: role,
        },
      );
      expect(out.cellId).toBe(`cell-${role}`);
    }
  });

  it("乐观并发不匹配 ⇒ VERSION_CHANGED，不得静默覆盖", async () => {
    const orchestrations = makeRepo();
    orchestrations.forceVersionMismatch = true;
    await expect(
      updateMatrixCell(
        { orchestrations },
        {
          projectId: "proj-1",
          cellId: "cell-1",
          agendaSegmentId: "seg-1",
          roleKey: "facilitator",
          content: "改动",
          canvasTemplateId: null,
          skillIds: [],
          expectedRevision: "stale-rev",
          actorProjectRole: "facilitator",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "VERSION_CHANGED" });
  });

  it("同一环节同一角色再次编辑是「改这条」而不是「加一条」", async () => {
    const orchestrations = makeRepo();
    await updateMatrixCell(
      { orchestrations },
      {
        projectId: "proj-1",
        cellId: "cell-1",
        agendaSegmentId: "seg-1",
        roleKey: "facilitator",
        content: "第一版",
        canvasTemplateId: null,
        skillIds: [],
        expectedRevision: "rev-1",
        actorProjectRole: "facilitator",
      },
    );
    await updateMatrixCell(
      { orchestrations },
      {
        projectId: "proj-1",
        cellId: "cell-1",
        agendaSegmentId: "seg-1",
        roleKey: "facilitator",
        content: "第二版",
        canvasTemplateId: null,
        skillIds: [],
        expectedRevision: "rev-2",
        actorProjectRole: "facilitator",
      },
    );
    const saved = await orchestrations.load("proj-1");
    expect(saved?.matrix).toHaveLength(1);
    expect(saved?.matrix[0]?.content).toBe("第二版");
  });
});
