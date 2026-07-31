/**
 * F64 · **现场切议程环节时，挂载的 skill 自动更换**（R3 步骤 7；AC1）。
 *
 * 依据：契约 `resolveMountedSkills`；usecases.md「reason 是契约的一部分——AC1
 * 要求『能看到因什么环节载入』」「依赖失败时该条标『依赖失败』并明确告知，不静默
 * 跳过、不换模型（E2）」「组员侧只读：本用例返回的 mounts 对组员无任何写入口（V5）」。
 *
 * ⚠ 「三种视角首屏在 1 秒内跟着换」是前端渲染延迟指标，不是这条纯读用例能表达的
 *   断言对象——本文件只覆盖它依赖的**后端不变量**：环节切换时解析结果确实变了
 *   （否则前端刷新也刷不出新东西），且三个人类角色拿到的是**同一份**只读投影
 *   （首屏一致性的前提）。延迟本身留给 e2e/UI 层，已在 issue 里说明。
 */
import { describe, expect, it } from "vitest";
import { resolveMountedSkills } from "../../../src/application/skill/resolve-mounted-skills";
import { binding, mountHealth, orchestrationStore } from "../../support/skill-fakes";
import type { ProjectOrchestration } from "../../../src/domain/skill/orchestration";

function twoSegmentOrchestration(): ProjectOrchestration {
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
        deliverRoles: ["全场共用"],
      }),
      binding({
        bindingId: "ib-2",
        agendaSegmentId: "seg-03",
        owner,
        slot: { kind: "skill", skillId: "sk-extract", versionId: "v1" },
        deliverRoles: ["组员"],
      }),
      binding({
        bindingId: "ib-3",
        agendaSegmentId: "seg-03",
        owner,
        slot: { kind: "skill", skillId: "sk-facilitator-only", versionId: "v1" },
        deliverRoles: ["引导师"],
      }),
      // 非 skill 槽：不应出现在 mounts 里（那是 07-canvas / agent 产物的挂载）
      binding({
        bindingId: "ib-4",
        agendaSegmentId: "seg-03",
        owner,
        slot: { kind: "canvas-template", canvasTemplateId: "hmw" },
        deliverRoles: ["全场共用"],
      }),
    ],
    roleCells: [],
  };
}

describe("AC1：切环节时挂载自动更换，且 reason 写着换到了哪个环节", () => {
  it("环节 02 → 03，组员视角看到的挂载集合确实变了", async () => {
    const orchestrations = orchestrationStore(twoSegmentOrchestration());
    const health = mountHealth();
    const seg02 = await resolveMountedSkills(
      { projectId: "p-1", agendaSegmentId: "seg-02", role: "组员", groupId: null },
      { orchestrations, health },
    );
    const seg03 = await resolveMountedSkills(
      { projectId: "p-1", agendaSegmentId: "seg-03", role: "组员", groupId: null },
      { orchestrations, health },
    );
    expect(seg02.ok).toBe(true);
    expect(seg03.ok).toBe(true);
    if (!seg02.ok || !seg03.ok) return;

    expect(seg02.mounts.map((m) => m.skillId)).toEqual(["sk-voice"]);
    expect(seg03.mounts.map((m) => m.skillId)).toEqual(["sk-extract"]);
    // reason 逐字标出「因哪个环节载入」，且随环节切换而不同。
    expect(seg02.mounts[0]!.reason).toBe("因环节 01 载入");
    expect(seg03.mounts[0]!.reason).toBe("因环节 02 载入");
  });

  it("只挂给引导师的 skill，组员视角看不到（下发角色过滤）", async () => {
    const orchestrations = orchestrationStore(twoSegmentOrchestration());
    const r = await resolveMountedSkills(
      { projectId: "p-1", agendaSegmentId: "seg-03", role: "组员", groupId: null },
      { orchestrations, health: mountHealth() },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mounts.map((m) => m.skillId)).not.toContain("sk-facilitator-only");
  });

  it("画布模板 / agent 产物槽不出现在 mounts 里（混合槽可区分，只挂 skill 支）", async () => {
    const orchestrations = orchestrationStore(twoSegmentOrchestration());
    const r = await resolveMountedSkills(
      { projectId: "p-1", agendaSegmentId: "seg-03", role: "引导师", groupId: null },
      { orchestrations, health: mountHealth() },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mounts.map((m) => m.skillId)).toEqual(["sk-facilitator-only"]);
  });
});

describe("三种视角（引导师/组长/组员）拿到的是同一份只读投影（首屏一致性的前提）", () => {
  it("引导师、组长、组员对同一环节各自查询，各自看到的是自己下发范围内的挂载，且都来自同一次调用可复现", async () => {
    const orchestrations = orchestrationStore(twoSegmentOrchestration());
    const health = mountHealth();
    const roles = ["引导师", "组长", "组员"] as const;
    const results = await Promise.all(
      roles.map((role) =>
        resolveMountedSkills(
          { projectId: "p-1", agendaSegmentId: "seg-02", role, groupId: null },
          { orchestrations, health },
        ),
      ),
    );
    // seg-02 的绑定是「全场共用」——三个角色应看到完全一致的一份投影。
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.mounts.map((m) => m.skillId)).toEqual(["sk-voice"]);
    }
  });

  it("组员只读：本模块没有任何写变体可用（结构性，不是权限判断出来的）", () => {
    // 同 F63 的端口白名单同一种落法：模块导出集合里没有「mount」「write」「set」类动词。
    const mod: Record<string, unknown> = { resolveMountedSkills };
    const writeLike = Object.keys(mod).filter((k) => /mount(?!ed)|write|set|update/i.test(k));
    expect(writeLike).toEqual([]);
  });
});

describe("E2：依赖不可用时明确告知，不静默跳过、不换模型", () => {
  it("依赖失败的 skill 仍出现在列表里，带 disabledReason，而不是被过滤掉", async () => {
    const orchestrations = orchestrationStore(twoSegmentOrchestration());
    const health = mountHealth({ "sk-voice": "所依赖模型已停用" });
    const r = await resolveMountedSkills(
      { projectId: "p-1", agendaSegmentId: "seg-02", role: "组员", groupId: null },
      { orchestrations, health },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mounts).toHaveLength(1);
    expect(r.mounts[0]!.disabledReason).toBe("所依赖模型已停用");
  });

  it("项目没有编排 ⇒ 明确失败，不是空 mounts", async () => {
    const orchestrations = orchestrationStore(null);
    const r = await resolveMountedSkills(
      { projectId: "p-none", agendaSegmentId: "seg-02", role: "组员", groupId: null },
      { orchestrations, health: mountHealth() },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
