/**
 * F58 / O-23 -- 项目级 AI 权限三开关：三粒度（组织/agent 级 → 项目级 → 画布/线程级）取
 * 交集，收紧优先，**下层不得放宽上层**。
 *
 * ## Reverse assertions first (AGENTS.md 纪律)
 *
 * 三条"仅这一粒度收紧、其余两层都放行"的用例排在"全放行"之前 —— 一个恒返回
 * `effective: true` 的实现能骗过只测正例的套件，只有专门构造"单一粒度收紧应当足以让整体
 * 收紧"的用例才能抓住它。
 */
import { describe, expect, it } from "vitest";
import {
  intersectAiPermissionGrains,
  intersectAllSwitches,
  disabledCapabilitiesOnChange,
  type AiPermissionGrainInput,
  type ProjectAiSwitchId,
} from "../../../src/domain/agent/project-ai-permission";

describe("F58 O-23 -- 三粒度求交：任一粒度收紧即生效，下层不得放宽上层", () => {
  it("① 组织/agent 级收紧：即使项目级、画布级都想开，整体仍关，tightenedBy = org-agent", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: false,
      projectSetting: true,
      canvasSetting: true,
    });
    expect(result.effective).toBe(false);
    expect(result.tightenedBy).toBe("org-agent");
  });

  it("② 项目级收紧：即使组织/agent 级放行、画布级想开，整体仍关，tightenedBy = project", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: true,
      projectSetting: false,
      canvasSetting: true,
    });
    expect(result.effective).toBe(false);
    expect(result.tightenedBy).toBe("project");
  });

  it("③ 画布/线程级收紧：即使上两层都放行，整体仍关，tightenedBy = canvas-thread", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: true,
      projectSetting: true,
      canvasSetting: false,
    });
    expect(result.effective).toBe(false);
    expect(result.tightenedBy).toBe("canvas-thread");
  });

  it("④ 三层都放行（含「未设置」视为不收紧）⇒ 允许（反向断言：不是恒拒绝的实现也会绿）", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: true,
      projectSetting: null,
      canvasSetting: null,
    });
    expect(result.effective).toBe(true);
    expect(result.tightenedBy).toBeNull();
  });

  it("⑤ agent 级允许插话但项目级关闭时仍不插话——精确复述 user_visible_behavior 的例子", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: true, // agent 级允许插话
      projectSetting: false, // 项目级关闭
      canvasSetting: null,
    });
    expect(result.effective).toBe(false);
    expect(result.tightenedBy).toBe("project");
  });

  it("⑥ 「画布级也无法再打开」——项目级已收紧时，画布级设 true 不能把结果放宽回 true", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: true,
      projectSetting: false,
      canvasSetting: true, // 试图在画布级"重新打开"
    });
    expect(result.effective).toBe(false);
    expect(result.tightenedBy).toBe("project"); // 不是 canvas-thread 放宽掉了它
  });

  it("⑦ 三层都拒绝时，tightenedBy 恒为最上层（org-agent），不是随意一层", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: false,
      projectSetting: false,
      canvasSetting: false,
    });
    expect(result.tightenedBy).toBe("org-agent");
  });

  it("⑧ grains 字段原样保留三层各自的事实，供界面解释「为什么」", () => {
    const result = intersectAiPermissionGrains({
      orgOrAgentAllows: true,
      projectSetting: null,
      canvasSetting: false,
    });
    expect(result.grains).toEqual({ orgAgent: true, project: null, canvasThread: false });
  });
});

describe("F58 -- intersectAllSwitches：三个开关各自独立求交，互不影响", () => {
  it("一个开关收紧不影响另外两个开关的有效值", () => {
    const inputs: Record<ProjectAiSwitchId, AiPermissionGrainInput> = {
      facilitatorProposesConvergence: {
        orgOrAgentAllows: true,
        projectSetting: false,
        canvasSetting: null,
      },
      liveTranscription: { orgOrAgentAllows: true, projectSetting: null, canvasSetting: null },
      aiWritesOnCanvas: { orgOrAgentAllows: true, projectSetting: null, canvasSetting: null },
    };
    const out = intersectAllSwitches(inputs);
    expect(out.facilitatorProposesConvergence.effective).toBe(false);
    expect(out.liveTranscription.effective).toBe(true);
    expect(out.aiWritesOnCanvas.effective).toBe(true);
  });
});

describe("F58 A5 -- disabledCapabilitiesOnChange：只报告 true→false 的跃迁", () => {
  const deps = [
    { switchId: "aiWritesOnCanvas" as ProjectAiSwitchId, capabilities: ["canvas-auto-write"] },
    {
      switchId: "liveTranscription" as ProjectAiSwitchId,
      capabilities: ["voice-to-note", "live-transcript"],
    },
  ];

  it("关闭一个开关 ⇒ 其依赖能力出现在 disabledCapabilities 里", () => {
    const disabled = disabledCapabilitiesOnChange(
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: true },
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: false },
      deps,
    );
    expect(disabled).toEqual(["canvas-auto-write"]);
  });

  it("反向断言：本来就是关的（false→false）不算「因本次关闭」，不误报", () => {
    const disabled = disabledCapabilitiesOnChange(
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: false },
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: false },
      deps,
    );
    expect(disabled).toEqual([]);
  });

  it("重新打开（false→true）不产生 disabledCapabilities", () => {
    const disabled = disabledCapabilitiesOnChange(
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: false },
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: true },
      deps,
    );
    expect(disabled).toEqual([]);
  });

  it("多个开关同时关闭 ⇒ 各自依赖的能力都出现", () => {
    const disabled = disabledCapabilitiesOnChange(
      { facilitatorProposesConvergence: true, liveTranscription: true, aiWritesOnCanvas: true },
      { facilitatorProposesConvergence: true, liveTranscription: false, aiWritesOnCanvas: false },
      deps,
    );
    expect([...disabled].sort()).toEqual(
      ["canvas-auto-write", "live-transcript", "voice-to-note"].sort(),
    );
  });
});
