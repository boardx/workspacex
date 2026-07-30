/**
 * 反证套件 —— 项目级 AI 权限三开关的**默认值待裁**（O-23 只裁了合成规则）
 *
 * ## 为什么这个文件存在
 * `feature_list` F58 的 `notes` 曾写「三个 AI 权限开关**默认全关**为 **O-23**」。
 * 实测那是**伪造出处**：`phases/requirements/DECISIONS-OPEN.md:655` 的 O-23 裁决行
 * **逐字只有一句**——「裁决：合成规则 = 取交集（收紧优先），且不可被下层放宽」。
 * 「默认全关」只出现在**推荐段**（`:650-651`），**裁决行未提**。
 *
 * 而**原型（权威，纪律第 7 条）说的是反的**
 * （`phases/requirements/WorkspaceX Standalone.html` 字节偏移；
 * 判读：`background:#17171A` + 旋钮 `right:2px` = 开，`#DEDCD3` + `left:2px` = 关）：
 *   · `15,253,200` 设置磁贴副标题逐字「AI 权限 / **3 项 · 1 项已关**」 ⇒ **2 项开**
 *   · `15,274,800` 主动提议收敛 = 开 · 语音转便签 = 开 · 画布落笔 = 关（本场覆写）
 *   · `15,214,600` 蓝本预览「与蓝本一致」段 `AI 可在小组画布落笔` = **开**（蓝本默认）
 * 且 `uc-4-2:103` 引 [D-10]「AI 画布写权限：**默认直接落笔**」，与蓝本默认一致。
 *
 * ⇒ 「全关」是**未被裁决、且被原型与 D-10 两次否定**的一侧。
 *
 * ## 这个文件守的是什么
 * 一个从未被裁决的 `false` 一旦落进代码，就会被写进测试断言并从此变成事实标准
 * （本仓已发生过一次：有人编了 `sampleSize=18` 和「口径表 v3」）。
 * 所以三项登记进 `THRESHOLDS`（`known: false`），**取值即抛错**。
 * 本套件逐条反证这件事**真的成立**，而不是「注释里写了」。
 *
 * ## 人类裁决落地后怎么改
 * 把三项改成 `{ known: true, value, source }`，`source` 记明裁决号。
 * 届时 ②③ 两条会失败——**那是正确的信号**，改成断言真实默认值即可。
 * ⚠ 在裁决落地前，**不许**把任何一侧写成断言。
 */
import { describe, it, expect } from "vitest";
import {
  THRESHOLDS,
  requireValue,
  pendingThresholds,
  blockingThresholds,
} from "../src/thresholds";

/** 三项的键名 —— 写死在这里是**故意**的：改名要让本文件红 */
const THREE = [
  "projectAiDefaultProposeConvergence",
  "projectAiDefaultVoiceToNote",
  "projectAiDefaultCanvasWrite",
] as const;

describe("项目级 AI 权限三开关：默认值无出处 → 待裁", () => {
  it("① 三项都在待定表里（不是被写成 known:true 混过去）", () => {
    const names = pendingThresholds().map((p) => p.name as string);
    for (const n of THREE) {
      expect(names, `${n} 不在待定表里 —— 它要么被悄悄定值了，要么被删了`).toContain(n);
    }
  });

  it("② 取值抛错，而不是静默返回 false —— 这是整条修正的核心", () => {
    for (const n of THREE) {
      expect(
        () => requireValue(THRESHOLDS[n] as never, n),
        `${n} 未裁却没抛错 —— 一个从未被裁决的 false 正在被当成事实`,
      ).toThrow(/尚未裁决/);
    }
  });

  it("③ 抛出的错里说得出「是哪一项、谁该给、卡住什么」", () => {
    for (const n of THREE) {
      let msg = "";
      try {
        requireValue(THRESHOLDS[n] as never, n);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, `${n} 没抛错`).toBeTruthy();
      expect(msg).toContain(n);
      expect(msg).toContain("不给会卡住");
      // 出处必须指回 O-23 与原型偏移，否则下一个人还是查不到为什么
      expect(msg).toContain("O-23");
    }
  });

  it("④ 三项标为真阻塞（🔴）—— 缺口要有名字、会在报告里出现（纪律第 10 条）", () => {
    const names = blockingThresholds().map((b) => b.name as string);
    for (const n of THREE) expect(names).toContain(n);
  });

  it("⑤ 反空转：断言不是因为集合为空而平凡为真", () => {
    // 若 THREE 被清空、或三项被改名，上面四条会静默全绿。这条堵掉它。
    expect(THREE.length).toBe(3);
    expect(new Set<string>(THREE).size).toBe(3);
    expect(pendingThresholds().length).toBeGreaterThanOrEqual(3);
  });

  it("⑥ 反证「恒抛错」：requireValue 对已定值的项**不抛错**", () => {
    // 缺这条时，一个 `throw` 写在函数第一行的实现会让 ② 全绿。
    expect(
      requireValue<boolean>(
        { known: true, value: false, rule: "已裁决的规则占位", source: "测试内联" },
        "fixture",
      ),
    ).toBe(false);
    expect(
      requireValue<boolean>(
        { known: true, value: true, rule: "已裁决的规则占位", source: "测试内联" },
        "fixture",
      ),
    ).toBe(true);
  });

  it("⑦ 三项的 rule 只描述**规则**，不得夹带一个默认值当结论", () => {
    for (const n of THREE) {
      const t = THRESHOLDS[n];
      expect(t.known).toBe(false);
      // 「默认全关」这四个字不许再出现在 rule 里 —— 它是被撤回的那一侧
      expect(t.rule, `${n} 的 rule 里又出现了「默认全关」`).not.toMatch(/默认全关/);
    }
  });
});
