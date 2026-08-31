/**
 * `applyTaskModePrefix`——issue #2417 里确认的真 bug 的单测。
 * 见 `lib/copilotkit-v2-task-mode.ts` 头注。
 */
import { describe, expect, it } from "vitest";
import { TASK_MODE_PREFIX, applyTaskModePrefix } from "@/lib/copilotkit-v2-task-mode";

describe("applyTaskModePrefix", () => {
  it("任务模式关闭时逐字节返回原文，不拼前缀", () => {
    expect(applyTaskModePrefix("研究设计思维的历史", false)).toBe("研究设计思维的历史");
  });

  it("任务模式开启、原文不含前缀时拼接一次", () => {
    expect(applyTaskModePrefix("研究设计思维的历史，然后做一个3页的ppt", true)).toBe(
      `${TASK_MODE_PREFIX}研究设计思维的历史，然后做一个3页的ppt`,
    );
  });

  it("issue #2417 真实复现：用户手动在正文里也打了这句前缀，开关不再重复拼接", () => {
    const rawText = `${TASK_MODE_PREFIX}研究设计思维的历史，然后做一个3页的ppt`;
    expect(applyTaskModePrefix(rawText, true)).toBe(rawText);
    // 幂等：不会变成"前缀+前缀+原文"。
    expect(applyTaskModePrefix(rawText, true)).not.toContain(
      `${TASK_MODE_PREFIX}${TASK_MODE_PREFIX}`,
    );
  });

  it("原文只是前缀本身（无正文）时也不重复拼接", () => {
    expect(applyTaskModePrefix(TASK_MODE_PREFIX, true)).toBe(TASK_MODE_PREFIX);
  });
});
