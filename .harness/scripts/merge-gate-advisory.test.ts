// merge-gate 的「仅记录模式」开关单测。
//
// 人类裁决 2026-08-20：merge-gate 暂时不再让 CI 变红（见 merge-gate.ts 的
// MERGE_GATE_ADVISORY_ONLY 注释）。一个只能靠人肉跑 CLI 验证的开关，下次重构
// 时会静默失效——本文件把两个方向都钉死，确保「改回 false 就恢复拦人」这句话
// 永远是真的，而不是一句写在注释里没人验证的承诺。
import { describe, expect, it } from "vitest";
import { MERGE_GATE_ADVISORY_ONLY, mergeGateExitCode } from "./merge-gate";

describe("mergeGateExitCode", () => {
  it("通过时退出 0（与开关无关）", () => {
    expect(mergeGateExitCode(true, true)).toBe(0);
    expect(mergeGateExitCode(true, false)).toBe(0);
  });
  it("不通过 + 仅记录模式 → 退出 0（放行，但 CLI 仍打印全部理由）", () => {
    expect(mergeGateExitCode(false, true)).toBe(0);
  });
  it("不通过 + 拦人模式 → 退出 1（把开关改回 false 必须真的恢复拦人）", () => {
    expect(mergeGateExitCode(false, false)).toBe(1);
  });
  it("当前仓库状态：仅记录模式开着——这条断言就是这个决定的可见记录", () => {
    // 如果有人把它改回 false（恢复拦人），这条会红，提醒改测试的人确认这是有意的。
    expect(MERGE_GATE_ADVISORY_ONLY).toBe(true);
  });
});
