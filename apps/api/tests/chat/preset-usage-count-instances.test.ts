/**
 * F115 —— 预设使用计数 = 真实实例数，不按下发人数估算（chat 束 domain.md I-38，
 * uc-8-4 UC-26）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   被测的是 `domain/chat/preset-usage.ts` 这一处唯一的计算——与
 *   `team-panel-presence-tri-state.test.ts`（F110）同一个纪律：先证明「计数与
 *   下发规模是两回事」，不只是断言一个数字凑巧对。
 *
 * ## 这个文件最重要的两条断言
 *
 * 1. **下发 10 人、3 人开始 ⇒ usageCount === 3**——不是 10。一个把 usageCount
 *    算成 `targetCount` 的实现在「谁都还没点开始」的场景上也会给出错误答案：
 *    下面第二个用例（0 人开始 ⇒ 0）单独把这一档拆出来断言。
 * 2. **同一人重复「开始」不会把计数刷高**——`dedupeInstancesByActor` 是那道防线，
 *    用一组含重复 `startedBy` 的夹具证明去重后计数不受影响。
 */
import { describe, expect, it } from "vitest";
import {
  dedupeInstancesByActor,
  presetUsageCount,
  type PresetInstanceRow,
} from "../../src/domain/chat/preset-usage";

describe("F115 预设使用计数（I-38）", () => {
  it("下发 10 人、3 人开始 ⇒ usageCount 恒等于 3，不是下发人数 10", () => {
    const instances: PresetInstanceRow[] = [
      { instanceId: "inst-1", startedBy: "u-1" },
      { instanceId: "inst-2", startedBy: "u-2" },
      { instanceId: "inst-3", startedBy: "u-3" },
    ];
    // 下发对象共 10 人（本测试不需要构造它们——usageCount 的计算不读 targetCount）。
    const dispatchTargetCount = 10;
    expect(presetUsageCount(instances)).toBe(3);
    expect(presetUsageCount(instances)).not.toBe(dispatchTargetCount);
  });

  it("下发给若干人、无人开始 ⇒ usageCount 为 0（不是估算成下发人数）", () => {
    expect(presetUsageCount([])).toBe(0);
  });

  it("同一人重复点「开始」产生的重复行不会把计数刷高（幂等重放的兜底断言）", () => {
    // 正常写路径靠 `UNIQUE (preset_id, started_by)` 约束这种重复行根本不会落库；
    // 这里构造「万一绕开了约束」的场景，证明 usageCount 的计算本身也不信任那份唯一性。
    const withDuplicateActor: PresetInstanceRow[] = [
      { instanceId: "inst-1", startedBy: "u-1" },
      { instanceId: "inst-1-retry", startedBy: "u-1" }, // 同一人的第二行
      { instanceId: "inst-2", startedBy: "u-2" },
    ];
    expect(presetUsageCount(withDuplicateActor)).toBe(2);
    expect(presetUsageCount(withDuplicateActor)).not.toBe(withDuplicateActor.length);
  });

  it("去重保留每个 actor 第一次出现的那一行（与幂等重放返回同一 instanceId 的语义一致）", () => {
    const rows: PresetInstanceRow[] = [
      { instanceId: "inst-original", startedBy: "u-1" },
      { instanceId: "inst-retry", startedBy: "u-1" },
    ];
    const deduped = dedupeInstancesByActor(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.instanceId).toBe("inst-original");
  });

  it("不同 actor 各自的实例都计入——去重只按 actor 折叠，不折叠不同的人", () => {
    const rows: PresetInstanceRow[] = [
      { instanceId: "inst-1", startedBy: "u-1" },
      { instanceId: "inst-2", startedBy: "u-2" },
      { instanceId: "inst-3", startedBy: "u-3" },
    ];
    expect(presetUsageCount(rows)).toBe(rows.length);
  });
});
