// doctor-outcome.test.ts — #394：doctor 必须分得出 CLEAN / PASS_WITH_DEBT / UNREACHABLE。
//
// 反证的缺陷（修复前实测，origin/main e3a56cf，本机无 gh）：
//   $ pnpm harness doctor --phase 01
//   doctor：体检 1 个 phase — 0 FAIL / 211 WARN
//   ✓ 审计链完整：所有 passing 都有真实非空证据、有对应 issue 且已合入 main…   （exit 0）
// GitHub 一次都没问到（①②③⑤ 四项检查被整段跳过），却逐字宣称「有对应 issue 且已合入
// main」——而那 211 条 WARN 说的正是反话。「问不到」被渲染成了「查过了，是绿的」。
//
// 这里锁住的不变量：**问不到 ⇒ 不是绿**。权威缺口存在时，结论必须是 UNREACHABLE，
// 文案不得出现完整性断言；CI（--strict）下退出码为 1。
import { describe, expect, it } from "vitest";
import { classifyDoctorOutcome, issueAuthorityGap } from "./doctor";

/** 完整性断言的措辞——UNREACHABLE / PASS_WITH_DEBT 下任何一条都不许出现。 */
const COMPLETENESS_CLAIMS = ["审计链完整", "有对应 issue", "已合入 main"];

describe("classifyDoctorOutcome — 三态 + 退出码策略（#394）", () => {
  it("零 FAIL、零 WARN、权威全部问到 ⇒ CLEAN / exit 0", () => {
    const v = classifyDoctorOutcome({ failCount: 0, warnCount: 0, authorityGaps: [], strict: false });
    expect(v.outcome).toBe("CLEAN");
    expect(v.exitCode).toBe(0);
    expect(v.summary).toContain("审计链完整");
  });

  it("零 FAIL 但有 WARN ⇒ PASS_WITH_DEBT，且不许再宣称完整", () => {
    const v = classifyDoctorOutcome({ failCount: 0, warnCount: 211, authorityGaps: [], strict: false });
    expect(v.outcome).toBe("PASS_WITH_DEBT");
    expect(v.exitCode).toBe(0);
    expect(v.summary).toContain("211");
    for (const claim of COMPLETENESS_CLAIMS) expect(v.summary).not.toContain(claim);
  });

  // ↓ 这一条就是缺陷本体：修复前 doctor 在这个输入下打绿并 exit 0。
  it("GitHub 问不到 ⇒ UNREACHABLE，绝不打绿（哪怕零 FAIL 零 WARN）", () => {
    const v = classifyDoctorOutcome({
      failCount: 0,
      warnCount: 0,
      authorityGaps: ["读不到 GitHub issue（gh 未安装）"],
      strict: false,
    });
    expect(v.outcome).toBe("UNREACHABLE");
    expect(v.outcome).not.toBe("CLEAN");
    for (const claim of COMPLETENESS_CLAIMS) expect(v.summary).not.toContain(claim);
    // 缺口本身必须说出来，而不是静悄悄降级
    expect(v.summary).toContain("读不到 GitHub issue（gh 未安装）");
  });

  it("feature_list 加载失败同样是权威缺口，不得渲染成健康", () => {
    const v = classifyDoctorOutcome({
      failCount: 0,
      warnCount: 3,
      authorityGaps: ["phase 07 的 feature_list.json 读取失败：Unexpected token }"],
      strict: false,
    });
    expect(v.outcome).toBe("UNREACHABLE");
    for (const claim of COMPLETENESS_CLAIMS) expect(v.summary).not.toContain(claim);
  });

  it("退出码策略是显式的：UNREACHABLE 在 pre-push 放行(0)、在 CI --strict 拦截(1)", () => {
    const gaps = ["读不到 GitHub issue（离线）"];
    // 本地没装 gh 很常见，不阻断开发——但结论仍是 UNREACHABLE，不是 CLEAN
    expect(classifyDoctorOutcome({ failCount: 0, warnCount: 0, authorityGaps: gaps, strict: false }).exitCode).toBe(0);
    // CI 上「问不到 GitHub」不等于绿（AGENTS.md 完成定义第 7 条）
    expect(classifyDoctorOutcome({ failCount: 0, warnCount: 0, authorityGaps: gaps, strict: true }).exitCode).toBe(1);
  });

  it("FAIL 压过一切：有 FAIL 时结论是 FAIL / exit 1，不因权威缺口被稀释", () => {
    const v = classifyDoctorOutcome({
      failCount: 22,
      warnCount: 5,
      authorityGaps: ["读不到 GitHub issue（离线）"],
      strict: false,
    });
    expect(v.outcome).toBe("FAIL");
    expect(v.exitCode).toBe(1);
  });
});

describe("issueAuthorityGap — 清单不可信必须变成一个说得出口的缺口（#394）", () => {
  it("gh 不可用 ⇒ 缺口，并点名哪几项检查没跑", () => {
    const gap = issueAuthorityGap({ kind: "unavailable", reason: "gh: command not found" });
    expect(gap).not.toBeNull();
    expect(gap).toContain("gh: command not found");
    expect(gap).toContain("issue 上可见");
  });

  it("清单可能被截断与「读不到」同级——残缺清单撑不起否定性判断", () => {
    expect(issueAuthorityGap({ kind: "truncated", count: 5000, limit: 5000 })).not.toBeNull();
  });

  it("清单完好 ⇒ 没有缺口，照常走 CLEAN / PASS_WITH_DEBT", () => {
    expect(issueAuthorityGap({ kind: "ok", issues: [] })).toBeNull();
  });

  it("端到端串起来：gh 不可用的那一跑，结论是 UNREACHABLE 而不是 CLEAN", () => {
    const gap = issueAuthorityGap({ kind: "unavailable", reason: "gh 未安装" });
    const v = classifyDoctorOutcome({
      failCount: 0,
      warnCount: 211,
      authorityGaps: [gap!],
      strict: false,
    });
    // 这四行就是 2026-09-21 实测那一跑的真实输入
    expect(v.outcome).toBe("UNREACHABLE");
    expect(v.summary).not.toContain("审计链完整");
    expect(v.summary).not.toContain("有对应 issue");
  });
});
