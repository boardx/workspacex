import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./lib/paths";

/**
 * #1030（2026-08-12 人类 Accept）：verify 失败**不得产生任何状态转移**。
 * 旧行为 `if (f.status === "not_started") f.status = "in_progress"` 是静默认领——
 * sprint 全量 verify 把非任务对象翻成 in_progress 写回权威清单，制造幽灵违规并
 * 经 assertSingleInProgress 卡死全 sprint（当晚真实发生，因果链见 #1030）。
 *
 * 源级门（同仓「规格只写一次」守门人的形状）：verify.ts 里不许再出现
 * 「向 in_progress 赋值」——合法的开工转移只属于 claim.ts。
 * 谁要恢复这个行为，必须先来改这条测试并在 PR 里解释为什么 #1030 错了。
 */
describe("#1030 verify 不静默认领", () => {
  it("verify.ts 源码中不存在把 status 赋成 in_progress 的语句", () => {
    const src = readFileSync(join(REPO_ROOT, ".harness", "scripts", "verify.ts"), "utf8");
    expect(src).not.toMatch(/status\s*=\s*["']in_progress["']/);
  });
  it("claim.ts 仍然是唯一的开工转移入口（反空转：那句赋值必须存在于 claim）", () => {
    const src = readFileSync(join(REPO_ROOT, ".harness", "scripts", "claim.ts"), "utf8");
    expect(src).toMatch(/in_progress/);
  });
});
