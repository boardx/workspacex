/**
 * F115 —— 下发范围校验：越范围在下发接口即拒绝，不是下发后失败（chat 束
 * domain.md I-40，uc-8-4 UC-24）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   被测的是 `domain/chat/preset-dispatch-scope.ts` 这一处唯一的收敛点。
 *   「某资源对下发对象是否可见」的真实判定数据来自组织层配置（03-skill/04-agent，
 *   phase-00 F15，跨分片依赖待确认——见该文件头），本测试不构造那份数据，
 *   只构造调用方已经算好的可见性事实，验证收敛点本身的行为。
 *
 * ## 这个文件最重要的三条断言
 *
 * 1. **预设引用「仅能源组」的 agent 并下发给非能源组 ⇒ 拒绝**，且错误标明是
 *    哪一层限制——domain.md 待人类裁决 12 条给的原文用例。
 * 2. **拒绝时报告的是第一个越范围的资源**，不是全部通过校验后才汇总失败——
 *    这与「原子性：拒绝时不得已经创建部分实例或部分通知」是同一件事的两个侧面：
 *    调用方必须能在动手之前就拿到「哪个资源、哪一层」这个可判定的结果。
 * 3. **全部资源都在范围内 ⇒ 放行**，且放行路径与拒绝路径必须能被同一组输入的
 *    小改动切换——不是一个把什么都放行的实现凑巧通过了用例 1。
 */
import { describe, expect, it } from "vitest";
import {
  checkPresetDispatchScope,
  presetTargetsFingerprint,
  type PresetResourceScopeFact,
} from "../../src/domain/chat/preset-dispatch-scope";

describe("F115 下发范围校验（I-40）", () => {
  it("预设引用「仅能源组」的 agent 并下发给非能源组 ⇒ 拒绝，标明是组织层限制", () => {
    const resources: PresetResourceScopeFact[] = [
      { kind: "agent", id: "agent-energy-only", visibleToTargets: false, deniedLayer: "organization" },
    ];
    const decision = checkPresetDispatchScope(resources);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.kind).toBe("agent");
      expect(decision.id).toBe("agent-energy-only");
      expect(decision.deniedLayer).toBe("organization");
    }
  });

  it("全部资源都在下发对象的可见范围内 ⇒ 放行（同一组输入的正对照）", () => {
    const resources: PresetResourceScopeFact[] = [
      { kind: "agent", id: "agent-energy-only", visibleToTargets: true, deniedLayer: "organization" },
      { kind: "skill", id: "skill-research", visibleToTargets: true, deniedLayer: "project" },
    ];
    expect(checkPresetDispatchScope(resources)).toEqual({ allowed: true });
  });

  it("skill 越范围同样被拒，且能与 agent 越范围区分（kind 不是恒为 agent）", () => {
    const resources: PresetResourceScopeFact[] = [
      { kind: "agent", id: "agent-ok", visibleToTargets: true, deniedLayer: "organization" },
      { kind: "skill", id: "skill-project-only", visibleToTargets: false, deniedLayer: "project" },
    ];
    const decision = checkPresetDispatchScope(resources);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.kind).toBe("skill");
      expect(decision.id).toBe("skill-project-only");
      expect(decision.deniedLayer).toBe("project");
    }
  });

  it("报告第一个越范围的资源，不等全部资源过完一遍再汇总", () => {
    const resources: PresetResourceScopeFact[] = [
      { kind: "agent", id: "agent-out-of-scope-1", visibleToTargets: false, deniedLayer: "organization" },
      { kind: "agent", id: "agent-out-of-scope-2", visibleToTargets: false, deniedLayer: "project" },
    ];
    const decision = checkPresetDispatchScope(resources);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.id).toBe("agent-out-of-scope-1");
    }
  });

  it("空资源列表（预设未引用任何 agent/skill）⇒ 放行", () => {
    expect(checkPresetDispatchScope([])).toEqual({ allowed: true });
  });

  it("幂等指纹与 groupIds/roles 的顺序无关——同一语义的两次下发折叠成同一次", () => {
    const a = presetTargetsFingerprint({ plenary: false, groupIds: ["g2", "g1"], roles: ["member"] });
    const b = presetTargetsFingerprint({ plenary: false, groupIds: ["g1", "g2"], roles: ["member"] });
    expect(a).toBe(b);
  });

  it("幂等指纹对不同的下发对象给出不同的结果（不是恒返回同一个字符串）", () => {
    const plenary = presetTargetsFingerprint({ plenary: true, groupIds: [], roles: [] });
    const scoped = presetTargetsFingerprint({ plenary: false, groupIds: ["g1"], roles: [] });
    expect(plenary).not.toBe(scoped);
  });
});
