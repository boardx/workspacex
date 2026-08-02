import { describe, expect, it } from "vitest";
import {
  planMatrixTaskSync,
  cellHasContent,
  executorSkillIdFor,
} from "../../src/domain/templates/matrix-task-sync";
import {
  syncMatrixToTasks,
  SyncMatrixToTasksError,
} from "../../src/application/templates/sync-matrix-to-tasks";
import {
  updateMatrixCell,
} from "../../src/application/templates/update-matrix-cell";
import type {
  MatrixRoleAssigneePort,
  MatrixTaskPublisherPort,
  OrchestrationRepository,
} from "../../src/application/templates/workflow-orchestration-ports";
import type { WorkflowOrchestrationSnapshot } from "../../src/domain/templates/workflow-orchestration";

/**
 * F27 —— 矩阵格 → 待办同步（`uc-2-2` R10 / 契约 `syncMatrixToTasks` + `updateMatrixCell`）。
 *
 * 断言逐条对应 issue #323 的 `user_visible_behavior`：
 * · 3 环节 × 3 角色 = 9 格 ⇒ 恰好 9 条待办
 * · 改格 → 联动更新对应待办
 * · 删格（或清空）→ 对应待办被移除，不留孤儿卡
 * · 重复触发同步 → 不产生重复卡（幂等）
 * · 待办负责人恒为人；agent 记「执行者」
 */

class FakeOrchestrationRepository implements OrchestrationRepository {
  store = new Map<string, WorkflowOrchestrationSnapshot>();
  async load(projectId: string) {
    return this.store.get(projectId) ?? null;
  }
  async replace(projectId: string, snapshot: WorkflowOrchestrationSnapshot) {
    this.store.set(projectId, snapshot);
  }
  async upsertCell(
    projectId: string,
    cell: WorkflowOrchestrationSnapshot["matrix"][number],
    _expectedRevision: string,
  ) {
    const current = this.store.get(projectId);
    if (current === undefined) return { ok: false as const };
    const key = (c: { agendaSegmentId: string; roleKey: string }) => `${c.agendaSegmentId}/${c.roleKey}`;
    const rest = current.matrix.filter((c) => key(c) !== key(cell));
    this.store.set(projectId, { ...current, matrix: [...rest, cell], revision: `rev-${rest.length + 2}` });
    return { ok: true as const, revision: `rev-${rest.length + 2}` };
  }
}

class FakeAssigneePort implements MatrixRoleAssigneePort {
  /** agendaSegmentId/roleKey -> principalId；未登记 = 无人可接 */
  readonly people = new Map<string, string>();
  async assigneeOf(input: { agendaSegmentId: string; roleKey: string }) {
    const principalId = this.people.get(`${input.agendaSegmentId}/${input.roleKey}`);
    return principalId === undefined ? null : { principalId };
  }
}

/** 待办卡的假存储——键控 upsert + 幂等移除，同端口文档要求的形状。 */
class FakeTaskPublisher implements MatrixTaskPublisherPort {
  readonly cards = new Map<string, { readonly todoId: string; readonly assigneePrincipalId: string; readonly executorAgentId: string | null; readonly content: string }>();
  upsertCalls = 0;
  async upsertForCell(input: {
    projectId: string;
    cellId: string;
    agendaSegmentId: string;
    roleKey: string;
    content: string;
    assigneePrincipalId: string;
    executorAgentId: string | null;
  }) {
    this.upsertCalls += 1;
    const key = `${input.projectId}/${input.cellId}`;
    const existing = this.cards.get(key);
    const todoId = existing?.todoId ?? `todo-${key}`;
    this.cards.set(key, {
      todoId,
      assigneePrincipalId: input.assigneePrincipalId,
      executorAgentId: input.executorAgentId,
      content: input.content,
    });
    return { ok: true as const, todoId, created: existing === undefined };
  }
  async removeForCell(projectId: string, cellId: string) {
    const key = `${projectId}/${cellId}`;
    const existed = this.cards.delete(key);
    return { ok: true as const, removed: existed };
  }
}

const SEGMENTS = ["seg-1", "seg-2", "seg-3"] as const;
const ROLES = ["facilitator", "groupLead", "member"] as const;

function nineCellSnapshot(): WorkflowOrchestrationSnapshot {
  const matrix = SEGMENTS.flatMap((segmentId) =>
    ROLES.map((roleKey) => ({
      cellId: `${segmentId}/${roleKey}`,
      agendaSegmentId: segmentId,
      roleKey,
      content: `${segmentId} 的 ${roleKey} 待办内容`,
      canvasTemplateId: null,
      skillIds: [] as string[],
    })),
  );
  return {
    template: { templateId: "tpl-1", name: "设计思维标准五步", sourceVersion: 2 },
    segments: SEGMENTS.map((agendaSegmentId) => ({ agendaSegmentId, title: agendaSegmentId, addedBy: null, optional: false })),
    matrix,
    revision: "rev-1",
  };
}

function makeDeps() {
  const orchestrations = new FakeOrchestrationRepository();
  const snapshot = nineCellSnapshot();
  orchestrations.store.set("proj-1", snapshot);
  const assignees = new FakeAssigneePort();
  for (const segmentId of SEGMENTS) {
    for (const roleKey of ROLES) {
      assignees.people.set(`${segmentId}/${roleKey}`, `person-${segmentId}-${roleKey}`);
    }
  }
  const tasks = new FakeTaskPublisher();
  return { orchestrations, assignees, tasks, snapshot };
}

describe("domain: planMatrixTaskSync", () => {
  it("非空格进 toUpsert，缺失/清空格进 toRemove", () => {
    const matrix = [
      { cellId: "c1", agendaSegmentId: "seg-1", roleKey: "facilitator", content: "开场", canvasTemplateId: null, skillIds: [] },
      { cellId: "c2", agendaSegmentId: "seg-1", roleKey: "member", content: "   ", canvasTemplateId: null, skillIds: [] },
    ];
    const plan = planMatrixTaskSync(matrix, ["c1", "c2", "c3-deleted"]);
    expect(plan.toUpsert.map((c) => c.cellId)).toEqual(["c1"]);
    expect([...plan.toRemove].sort()).toEqual(["c2", "c3-deleted"]);
  });

  it("cellHasContent：空白视同未填", () => {
    expect(cellHasContent({ content: "有内容" })).toBe(true);
    expect(cellHasContent({ content: "   " })).toBe(false);
    expect(cellHasContent({ content: "" })).toBe(false);
  });

  it("executorSkillIdFor：有 skillIds 取第一个，否则 null", () => {
    expect(executorSkillIdFor({ skillIds: ["skill-a", "skill-b"] })).toBe("skill-a");
    expect(executorSkillIdFor({ skillIds: [] })).toBeNull();
  });
});

describe("application: syncMatrixToTasks —— 3 环节 × 3 角色 = 9 格 ⇒ 恰好 9 条待办", () => {
  it("9 个非空格同步后恰好 created 9 条", async () => {
    const { orchestrations, assignees, tasks, snapshot } = makeDeps();
    const out = await syncMatrixToTasks(
      { orchestrations, assignees, tasks },
      { projectId: "proj-1", cellIds: snapshot.matrix.map((c) => c.cellId) },
    );
    expect(out.created).toHaveLength(9);
    expect(out.updated).toHaveLength(0);
    expect(out.removed).toHaveLength(0);
    expect(tasks.cards.size).toBe(9);
  });

  it("负责人恒为人：每条待办卡的 assigneePrincipalId 来自 RoleAssigneePort，不是 executorAgentId", async () => {
    const { orchestrations, assignees, tasks, snapshot } = makeDeps();
    // 给 seg-1/facilitator 挂一个 skill（记「执行者」）
    orchestrations.store.set("proj-1", {
      ...snapshot,
      matrix: snapshot.matrix.map((c) =>
        c.cellId === "seg-1/facilitator" ? { ...c, skillIds: ["skill-voice-to-note"] } : c,
      ),
    });
    await syncMatrixToTasks(
      { orchestrations, assignees, tasks },
      { projectId: "proj-1", cellIds: ["seg-1/facilitator"] },
    );
    const card = tasks.cards.get("proj-1/seg-1/facilitator");
    expect(card?.assigneePrincipalId).toBe("person-seg-1-facilitator");
    expect(card?.executorAgentId).toBe("skill-voice-to-note");
    // 执行者绝不会串进负责人字段
    expect(card?.assigneePrincipalId).not.toBe(card?.executorAgentId);
  });

  it("改格内容 ⇒ 联动更新同一张卡（todoId 不变，content 更新，created=false）", async () => {
    const { orchestrations, assignees, tasks } = makeDeps();
    await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds: ["seg-1/facilitator"] });
    const firstTodoId = tasks.cards.get("proj-1/seg-1/facilitator")?.todoId;

    const snap = await orchestrations.load("proj-1");
    await orchestrations.upsertCell(
      "proj-1",
      { ...snap!.matrix.find((c) => c.cellId === "seg-1/facilitator")!, content: "改过的内容" },
      snap!.revision,
    );
    const out = await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds: ["seg-1/facilitator"] });

    expect(out.created).toHaveLength(0);
    expect(out.updated).toEqual([firstTodoId]);
    expect(tasks.cards.get("proj-1/seg-1/facilitator")?.content).toBe("改过的内容");
    expect(tasks.cards.size).toBe(1); // 没有产生第二张卡
  });

  it("删格（不再出现在矩阵里）⇒ 对应待办被移除，不留孤儿卡", async () => {
    const { orchestrations, assignees, tasks, snapshot } = makeDeps();
    await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds: ["seg-1/facilitator"] });
    expect(tasks.cards.size).toBe(1);

    // 模拟删格：从矩阵里拿掉这一格
    orchestrations.store.set("proj-1", {
      ...snapshot,
      matrix: snapshot.matrix.filter((c) => c.cellId !== "seg-1/facilitator"),
    });
    const out = await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds: ["seg-1/facilitator"] });

    expect(out.removed).toEqual(["seg-1/facilitator"]);
    expect(tasks.cards.size).toBe(0);
  });

  it("清空格内容（未删格，但 content 变空白）同样视为要移除对应待办", async () => {
    const { orchestrations, assignees, tasks } = makeDeps();
    await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds: ["seg-1/facilitator"] });
    expect(tasks.cards.size).toBe(1);

    const snap = await orchestrations.load("proj-1");
    await orchestrations.upsertCell(
      "proj-1",
      { ...snap!.matrix.find((c) => c.cellId === "seg-1/facilitator")!, content: "   " },
      snap!.revision,
    );
    const out = await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds: ["seg-1/facilitator"] });
    expect(out.removed).toEqual(["seg-1/facilitator"]);
    expect(tasks.cards.size).toBe(0);
  });

  it("重复触发同步（同一批 cellIds 再跑一次）不产生重复卡——幂等", async () => {
    const { orchestrations, assignees, tasks, snapshot } = makeDeps();
    const cellIds = snapshot.matrix.map((c) => c.cellId);
    const first = await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds });
    const second = await syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "proj-1", cellIds });

    expect(first.created).toHaveLength(9);
    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(9);
    expect(tasks.cards.size).toBe(9); // 第二次没有多出卡
    expect(tasks.upsertCalls).toBe(18); // 两次各 9 次调用，但存量恒为 9 张
  });

  it("找不到负责人（角色无人接）⇒ TASK_SYNC_FAILED，不静默用 agent 顶替", async () => {
    const { orchestrations, tasks } = makeDeps();
    const emptyAssignees = new FakeAssigneePort(); // 谁都没登记
    await expect(
      syncMatrixToTasks(
        { orchestrations, assignees: emptyAssignees, tasks },
        { projectId: "proj-1", cellIds: ["seg-1/facilitator"] },
      ),
    ).rejects.toBeInstanceOf(SyncMatrixToTasksError);
    expect(tasks.cards.size).toBe(0);
  });

  it("项目无编排快照 ⇒ DEPENDENCY_UNAVAILABLE", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    const assignees = new FakeAssigneePort();
    const tasks = new FakeTaskPublisher();
    await expect(
      syncMatrixToTasks({ orchestrations, assignees, tasks }, { projectId: "no-such-project", cellIds: ["x"] }),
    ).rejects.toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
  });
});

describe("application: updateMatrixCell 接线 F27（deps.taskSync 提供时）", () => {
  it("提供 taskSync 时，写格成功后 syncedTaskIds 是真实同步出的待办 id，不再恒为空", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    orchestrations.store.set("proj-1", {
      template: { templateId: "tpl-1", name: "t", sourceVersion: 1 },
      segments: [{ agendaSegmentId: "seg-1", title: "seg-1", addedBy: null, optional: false }],
      matrix: [],
      revision: "rev-1",
    });
    const assignees = new FakeAssigneePort();
    assignees.people.set("seg-1/facilitator", "person-1");
    const tasks = new FakeTaskPublisher();

    const out = await updateMatrixCell(
      { orchestrations, taskSync: { assignees, tasks } },
      {
        projectId: "proj-1",
        cellId: "cell-1",
        agendaSegmentId: "seg-1",
        roleKey: "facilitator",
        content: "开场引导",
        canvasTemplateId: null,
        skillIds: [],
        expectedRevision: "rev-1",
        actorProjectRole: "facilitator",
      },
    );

    expect(out.syncedTaskIds).toHaveLength(1);
    expect(tasks.cards.size).toBe(1);
  });

  it("不提供 taskSync 时保持既有行为：syncedTaskIds 恒为空（向后兼容）", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    orchestrations.store.set("proj-1", {
      template: { templateId: "tpl-1", name: "t", sourceVersion: 1 },
      segments: [{ agendaSegmentId: "seg-1", title: "seg-1", addedBy: null, optional: false }],
      matrix: [],
      revision: "rev-1",
    });
    const out = await updateMatrixCell(
      { orchestrations },
      {
        projectId: "proj-1",
        cellId: "cell-1",
        agendaSegmentId: "seg-1",
        roleKey: "facilitator",
        content: "开场引导",
        canvasTemplateId: null,
        skillIds: [],
        expectedRevision: "rev-1",
        actorProjectRole: "facilitator",
      },
    );
    expect(out.syncedTaskIds).toEqual([]);
  });
});
