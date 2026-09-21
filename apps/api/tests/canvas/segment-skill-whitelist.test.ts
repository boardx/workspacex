/**
 * #1468 — `projectSegmentSkillWhitelist`：绑定行 → 左栏第三区白名单的那一条判定。
 *
 * 只有一条，而它是**不丢行**：白名单必须恒等于绑定集合。`runSegmentSkill` 判的是绑定
 * （I-32「未绑定即拒绝」），所以任何「名字查不到就不显示」的实现都会造出一个
 * 「列表里没有、却能跑」的 skill——而那种不一致没有任何东西会报警。
 *
 * ⚠ 这里不重复 HTTP 那一层已经证过的事（权限、落库、跨租户）：那些在
 * `segment-skill-binding-http.test.ts` 里对着真 PG 断言。本文件只钉住这一个纯函数，
 * 因为它是唯一一处「契约没直说、实现必须选一个」的读侧判定。
 */
import { describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { projectSegmentSkillWhitelist } from "../../src/domain/canvas/segment-binding";

describe("#1468 · 议程环节 skill 白名单投影", () => {
  it("名字查得到时用名字", () => {
    expect(projectSegmentSkillWhitelist([
      { skillKey: "persona-digger", displayName: "画像深挖", runMode: "once", lastRunAt: null },
    ])).toEqual([
      { skillKey: "persona-digger", displayName: "画像深挖", runMode: "once", lastRunAt: null },
    ]);
  });

  it("名字查不到（绑定表对 skills 没有外键）：行保留，displayName 退回 skillKey", () => {
    expect(projectSegmentSkillWhitelist([
      { skillKey: "ghost", displayName: null, runMode: "always-on", lastRunAt: null },
    ])).toEqual([
      { skillKey: "ghost", displayName: "ghost", runMode: "always-on", lastRunAt: null },
    ]);
  });

  it("一半有名字一半没有：两行都在，顺序与输入一致（排序是仓储的 ORDER BY 定的）", () => {
    const out = projectSegmentSkillWhitelist([
      { skillKey: "a", displayName: null, runMode: "once", lastRunAt: null },
      { skillKey: "b", displayName: "乙", runMode: "once", lastRunAt: null },
    ]);
    expect(out.map((s) => s.skillKey)).toEqual(["a", "b"]);
    expect(out.map((s) => s.displayName)).toEqual(["a", "乙"]);
  });

  it("空绑定 ⇒ 空白名单（uc-7-1 V6 的真实空态，不编示例）", () => {
    expect(projectSegmentSkillWhitelist([])).toEqual([]);
  });

  /**
   * ⚠ 空字符串**不**触发回退：`skills.name` 有 `CHECK (length(name) > 0)`，空串真出现在
   *   这里说明查询串错了列。用 `||` 写的实现会把那种错误静默伪装成「这个 skill 没名字」，
   *   这条用例就是那次静默的反证。
   */
  it("空字符串名字原样带出，不当作「查不到」", () => {
    expect(projectSegmentSkillWhitelist([
      { skillKey: "weird", displayName: "", runMode: "once", lastRunAt: null },
    ])[0]!.displayName).toBe("");
  });

  it("lastRunAt 原样带出——它是 runSegmentSkill 的写入点，本投影不替它编时间", () => {
    const stamped = projectSegmentSkillWhitelist([
      { skillKey: "s", displayName: "S", runMode: "once", lastRunAt: "2026-09-21T10:00:00.000Z" },
    ]);
    expect(stamped[0]!.lastRunAt).toBe("2026-09-21T10:00:00.000Z");
  });

  /** 投影的产物必须能原样过契约的 `.strict()`——多一个字段在这里红。 */
  it("投影结果逐字满足契约 listSegmentSkills.out", () => {
    const skills = projectSegmentSkillWhitelist([
      { skillKey: "a", displayName: null, runMode: "once", lastRunAt: null },
      { skillKey: "b", displayName: "乙", runMode: "always-on", lastRunAt: "2026-09-21T10:00:00.000Z" },
    ]);
    expect(() => C.operations.listSegmentSkills.out.parse({ skills })).not.toThrow();
  });
});
