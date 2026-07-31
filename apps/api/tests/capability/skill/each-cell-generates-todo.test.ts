/**
 * F64 · **编排矩阵的每一个非空角色格 → 恰一条待办**（I-16 / D-39）。
 *
 * 依据：契约 `generateRoleTodos`；domain.md I-16「计数断言 count(非空格) =
 * count(生成的待办)；断言无 assignee 为 agent 的行（agent 只在 executor）」；
 * usecases.md「同步失败编排仍保存成功，但必须返回 failed…（E4/V12）」。
 *
 * 断言拆成三条方向不同的，因为只做第一条会放过一整类坏实现：
 *   ① 计数：非空格数 = created + failed 总数，空格不产出任何待办尝试。
 *   ② D-39 结构性：assignee 恒为人（来自 RoleAssigneePort），executor 只在有
 *      agent-output 绑定命中时才非 null（来自绑定表，与 assignee 来源互不相交）。
 *   ③ 局部失败不拖垮整批：一格同步失败，其余格子仍正常入 created，
 *      整体用例 `ok: true`（E4：「同步失败**编排仍保存成功**」）。
 */
import { describe, expect, it } from "vitest";
import { generateRoleTodos } from "../../../src/application/skill/generate-role-todos";
import {
  assigneeTable,
  binding,
  orchestrationStore,
  todoPublisher,
} from "../../support/skill-fakes";
import type { ProjectOrchestration } from "../../../src/domain/skill/orchestration";

function baseOrchestration(): ProjectOrchestration {
  return {
    projectId: "p-1",
    sourceTemplateId: "tpl-1",
    sourceTemplateVersion: 2,
    segments: [
      { agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 },
      { agendaSegmentId: "seg-03", title: "商业模式", durationMinutes: 60 },
    ],
    bindings: [
      binding({
        bindingId: "ib-1",
        agendaSegmentId: "seg-03",
        owner: { level: "instance", projectId: "p-1" },
        slot: { kind: "agent-output", agentId: "scout", outputKey: "briefing" },
        deliverRoles: ["引导师"],
      }),
    ],
    roleCells: [
      { agendaSegmentId: "seg-02", role: "引导师", text: "计时 · 提议收敛" },
      { agendaSegmentId: "seg-02", role: "组长", text: "分工 · 补必填区" },
      { agendaSegmentId: "seg-02", role: "组员", text: "" }, // 空格：不该产出待办
      { agendaSegmentId: "seg-03", role: "引导师", text: "读简报并同步全场" },
    ],
  };
}

describe("① 计数：非空格 ↔ 恰一条待办，空格不产出任何尝试", () => {
  it("三个非空格 → created+failed 恰好 3，空格一条都不进", async () => {
    const orchestrations = orchestrationStore(baseOrchestration());
    const publisher = todoPublisher();
    const r = await generateRoleTodos(
      { projectId: "p-1" },
      {
        orchestrations,
        assignees: assigneeTable({
          "seg-02/引导师": "u-facilitator",
          "seg-02/组长": "u-leader",
          "seg-03/引导师": "u-facilitator",
        }),
        todos: publisher,
      },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.created.length + r.failed.length).toBe(3);
    expect(publisher.published).toHaveLength(3);
    expect(publisher.published.some((p) => p.agendaSegmentId === "seg-02" && p.role === "组员")).toBe(
      false,
    );
  });

  it("空项目（无编排）⇒ 明确失败，不是空 created", async () => {
    const orchestrations = orchestrationStore(null);
    const r = await generateRoleTodos(
      { projectId: "p-none" },
      { orchestrations, assignees: assigneeTable({}), todos: todoPublisher() },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});

describe("② D-39：待办负责人恒为人，agent 记在独立的 executor 字段", () => {
  it("有 agent-output 绑定命中的格子，executor 是那个 agentId；assignee 另有其人", async () => {
    const orchestrations = orchestrationStore(baseOrchestration());
    const publisher = todoPublisher();
    await generateRoleTodos(
      { projectId: "p-1" },
      {
        orchestrations,
        assignees: assigneeTable({
          "seg-02/引导师": "u-facilitator",
          "seg-02/组长": "u-leader",
          "seg-03/引导师": "u-facilitator",
        }),
        todos: publisher,
      },
    );
    const seg03 = publisher.published.find((p) => p.agendaSegmentId === "seg-03")!;
    expect(seg03.executorAgentId).toBe("scout");
    expect(seg03.assigneePrincipalId).toBe("u-facilitator");
    // 两者绝不相等——assignee 的取数通路（RoleAssigneePort）与 executor 的取数通路
    // （绑定表 agent-output 槽）结构性不相交，agent id 混不进 assignee 字段。
    expect(seg03.assigneePrincipalId).not.toBe(seg03.executorAgentId);
  });

  it("没有 agent-output 绑定命中的格子，executor 恒为 null（不是恒为某个默认 agent）", async () => {
    const orchestrations = orchestrationStore(baseOrchestration());
    const publisher = todoPublisher();
    await generateRoleTodos(
      { projectId: "p-1" },
      {
        orchestrations,
        assignees: assigneeTable({
          "seg-02/引导师": "u-facilitator",
          "seg-02/组长": "u-leader",
          "seg-03/引导师": "u-facilitator",
        }),
        todos: publisher,
      },
    );
    const seg02 = publisher.published.filter((p) => p.agendaSegmentId === "seg-02");
    expect(seg02.every((p) => p.executorAgentId === null)).toBe(true);
    expect(seg02.every((p) => typeof p.assigneePrincipalId === "string" && p.assigneePrincipalId.length > 0)).toBe(
      true,
    );
  });

  it("角色找不到人接 ⇒ 计入 failed，不产出一条 assignee 为空的待办", async () => {
    const orchestrations = orchestrationStore(baseOrchestration());
    const publisher = todoPublisher();
    const r = await generateRoleTodos(
      { projectId: "p-1" },
      {
        orchestrations,
        // 故意漏配 seg-02/组长 的人选
        assignees: assigneeTable({
          "seg-02/引导师": "u-facilitator",
          "seg-03/引导师": "u-facilitator",
        }),
        todos: publisher,
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.failed).toContainEqual({ agendaSegmentId: "seg-02", roleKey: "组长" });
    expect(publisher.published.some((p) => p.role === "组长")).toBe(false);
  });
});

describe("③ 局部同步失败不拖垮整批（E4/V12：编排仍保存成功）", () => {
  it("一格发布失败，其余格子仍正常 created，整体结果 ok:true", async () => {
    const orchestrations = orchestrationStore(baseOrchestration());
    const publisher = todoPublisher(new Set(["seg-02/组长"]));
    const r = await generateRoleTodos(
      { projectId: "p-1" },
      {
        orchestrations,
        assignees: assigneeTable({
          "seg-02/引导师": "u-facilitator",
          "seg-02/组长": "u-leader",
          "seg-03/引导师": "u-facilitator",
        }),
        todos: publisher,
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toHaveLength(2);
    expect(r.failed).toEqual([{ agendaSegmentId: "seg-02", roleKey: "组长" }]);
  });

  it("发布端口直接抛异常也不中断整批（视同该条失败）", async () => {
    const orchestrations = orchestrationStore(baseOrchestration());
    let calls = 0;
    const throwing = {
      published: [] as unknown[],
      async publish(input: { agendaSegmentId: string; role: string }) {
        calls += 1;
        if (input.agendaSegmentId === "seg-03") throw new Error("outbox 挂了");
        return { ok: true as const, todoId: `todo-${calls}` };
      },
    };
    const r = await generateRoleTodos(
      { projectId: "p-1" },
      {
        orchestrations,
        assignees: assigneeTable({
          "seg-02/引导师": "u-facilitator",
          "seg-02/组长": "u-leader",
          "seg-03/引导师": "u-facilitator",
        }),
        todos: throwing,
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toHaveLength(2);
    expect(r.failed).toEqual([{ agendaSegmentId: "seg-03", roleKey: "引导师" }]);
  });
});
