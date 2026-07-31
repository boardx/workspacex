/**
 * F64 · **切模板/删环节：先列出将丢失的绑定与分工并要求确认，没有条目被静默丢弃**
 * （domain.md I-26；usecases.md AC6/V6）。
 *
 * 依据：契约 `previewOrphanBindings`（纯读，零写入）/ `confirmOrphanDisposition`
 * （逐条处置，无「全部忽略」）。
 *
 * 断言拆四条：
 *   ① `previewOrphanBindings` 对两种变更（删环节 / 切模板）各自算对丢失清单，且**零写入**。
 *   ② `confirmOrphanDisposition` 裁决覆盖不全 ⇒ `ORPHAN_BINDING_UNRESOLVED`，零写入。
 *   ③ 覆盖齐全后正确落地：migrate 真的换了环节，delete 真的消失，其余绑定纹丝不动。
 *   ④ 迁移目标指向不存在的环节 ⇒ 同样拒绝、零写入（迁到虚空等于换个写法的静默丢弃）。
 */
import { describe, expect, it } from "vitest";
import { previewOrphanBindings } from "../../../src/application/skill/preview-orphan-bindings";
import { confirmOrphanDisposition } from "../../../src/application/skill/confirm-orphan-disposition";
import { binding, orchestrationStore } from "../../support/skill-fakes";
import type { ProjectOrchestration } from "../../../src/domain/skill/orchestration";

function threeBindingOrchestration(): ProjectOrchestration {
  const owner = { level: "instance", projectId: "p-1" } as const;
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
        agendaSegmentId: "seg-02",
        owner,
        slot: { kind: "skill", skillId: "sk-voice", versionId: "v2" },
      }),
      binding({
        bindingId: "ib-2",
        agendaSegmentId: "seg-03",
        owner,
        slot: { kind: "skill", skillId: "sk-extract", versionId: "v1" },
      }),
      binding({
        bindingId: "ib-3",
        agendaSegmentId: "seg-03",
        owner,
        slot: { kind: "canvas-template", canvasTemplateId: "hmw" },
      }),
    ],
    roleCells: [
      { agendaSegmentId: "seg-02", role: "引导师", text: "计时" },
      { agendaSegmentId: "seg-03", role: "组长", text: "分工" },
    ],
  };
}

describe("① previewOrphanBindings：纯读，零写入，两种变更各自算对丢失清单", () => {
  it("删环节 seg-03：只有那个环节上的绑定与角色格算丢失", async () => {
    const orchestrations = orchestrationStore(threeBindingOrchestration());
    const r = await previewOrphanBindings(
      { projectId: "p-1", changeKind: "remove-segment", targetId: "seg-03" },
      { orchestrations },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.lostBindings.map((b) => b.bindingId).sort()).toEqual(["ib-2", "ib-3"]);
    expect(r.lostRoleCells).toEqual([{ agendaSegmentId: "seg-03", roleKey: "组长" }]);
    // seg-02 上的东西不受影响。
    expect(r.lostBindings.some((b) => b.bindingId === "ib-1")).toBe(false);
    // 纯读：一次写都没发生。
    expect(orchestrations.saves).toEqual([]);
  });

  it("切模板：整份实例的绑定与角色格全部算丢失（旧实例被整体替换）", async () => {
    const orchestrations = orchestrationStore(threeBindingOrchestration());
    const r = await previewOrphanBindings(
      { projectId: "p-1", changeKind: "switch-template", targetId: "tpl-new" },
      { orchestrations },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lostBindings.map((b) => b.bindingId).sort()).toEqual(["ib-1", "ib-2", "ib-3"]);
    expect(r.lostRoleCells).toHaveLength(2);
    expect(orchestrations.saves).toEqual([]);
  });

  it("项目没有编排 ⇒ 明确失败，而不是空清单（空清单会被误读成『什么都不会丢』）", async () => {
    const orchestrations = orchestrationStore(null);
    const r = await previewOrphanBindings(
      { projectId: "p-none", changeKind: "remove-segment", targetId: "seg-03" },
      { orchestrations },
    );
    expect(r.ok).toBe(false);
  });
});

describe("② confirmOrphanDisposition：裁决覆盖不全 ⇒ 拒绝且零写入", () => {
  it("删环节 seg-03 涉及 ib-2/ib-3 两条，只裁决了 ib-2 ⇒ ORPHAN_BINDING_UNRESOLVED", async () => {
    // 模拟「上游（templates 束）已经把 seg-03 从 segments 里摘掉」，
    // 留下两条绑定悬空——这正是 danglingBindings 的判定对象。
    const dangling: ProjectOrchestration = {
      ...threeBindingOrchestration(),
      segments: [{ agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 }],
    };
    const orchestrations = orchestrationStore(dangling);
    const before = orchestrations.saves.length;
    const r = await confirmOrphanDisposition(
      {
        projectId: "p-1",
        dispositions: [{ bindingId: "ib-2", action: "delete", toAgendaSegmentId: null }],
      },
      { orchestrations },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("ORPHAN_BINDING_UNRESOLVED");
    expect(r.reason).toContain("ib-3");
    expect(orchestrations.saves).toHaveLength(before);
  });

  it("一条裁决都不给（模拟『全部忽略』）⇒ 同样拒绝，零写入", async () => {
    const dangling: ProjectOrchestration = {
      ...threeBindingOrchestration(),
      segments: [{ agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 }],
    };
    const orchestrations = orchestrationStore(dangling);
    const r = await confirmOrphanDisposition(
      { projectId: "p-1", dispositions: [] },
      { orchestrations },
    );
    expect(r.ok).toBe(false);
    expect(orchestrations.saves).toEqual([]);
  });
});

describe("③ 覆盖齐全后正确落地：migrate 换环节、delete 真的消失、其余不动", () => {
  it("ib-2 迁到 seg-02，ib-3 删除，ib-1 纹丝不动", async () => {
    const dangling: ProjectOrchestration = {
      ...threeBindingOrchestration(),
      segments: [{ agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 }],
    };
    const orchestrations = orchestrationStore(dangling);
    const r = await confirmOrphanDisposition(
      {
        projectId: "p-1",
        dispositions: [
          { bindingId: "ib-2", action: "migrate", toAgendaSegmentId: "seg-02" },
          { bindingId: "ib-3", action: "delete", toAgendaSegmentId: null },
        ],
      },
      { orchestrations },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.applied).toBe(2);
    expect(orchestrations.saves).toHaveLength(1);
    const saved = orchestrations.saves[0]!;
    expect(saved.bindings.map((b) => b.bindingId).sort()).toEqual(["ib-1", "ib-2"]);
    expect(saved.bindings.find((b) => b.bindingId === "ib-2")?.agendaSegmentId).toBe("seg-02");
    expect(saved.bindings.find((b) => b.bindingId === "ib-1")?.agendaSegmentId).toBe("seg-02");
  });
});

describe("④ 迁移目标指向不存在的环节 ⇒ 拒绝（迁到虚空是静默丢弃的另一种写法）", () => {
  it("toAgendaSegmentId 指向一个不在 segments 里的环节 ⇒ 拒绝，零写入", async () => {
    const dangling: ProjectOrchestration = {
      ...threeBindingOrchestration(),
      segments: [{ agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 }],
    };
    const orchestrations = orchestrationStore(dangling);
    const r = await confirmOrphanDisposition(
      {
        projectId: "p-1",
        dispositions: [
          { bindingId: "ib-2", action: "migrate", toAgendaSegmentId: "seg-不存在" },
          { bindingId: "ib-3", action: "delete", toAgendaSegmentId: null },
        ],
      },
      { orchestrations },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("ORPHAN_BINDING_UNRESOLVED");
    expect(orchestrations.saves).toEqual([]);
  });

  it("migrate 缺 toAgendaSegmentId（null）⇒ 同样拒绝", async () => {
    const dangling: ProjectOrchestration = {
      ...threeBindingOrchestration(),
      segments: [{ agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 }],
    };
    const orchestrations = orchestrationStore(dangling);
    const r = await confirmOrphanDisposition(
      {
        projectId: "p-1",
        dispositions: [
          { bindingId: "ib-2", action: "migrate", toAgendaSegmentId: null },
          { bindingId: "ib-3", action: "delete", toAgendaSegmentId: null },
        ],
      },
      { orchestrations },
    );
    expect(r.ok).toBe(false);
    expect(orchestrations.saves).toEqual([]);
  });
});
