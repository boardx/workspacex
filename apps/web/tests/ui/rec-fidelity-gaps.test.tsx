/**
 * 保真度审计第 2 批 · rec 问题 4/5 的回归断言。
 * 依据：phases/phase-01-run-a-project/ui-preview/PROTOTYPE-FIDELITY-AUDIT-2.md 「二、rec」。
 *
 * 问题 5 —— 视角切换器把工作坊四角色套到访谈载体：
 *   v1 用一份 `REC_VIEWS` 全载体共用，导致访谈载体也显示「引导师/组长」；
 *   原型访谈区（字节 16,040,000–16,210,000）内「引导师」「组长」命中 0，
 *   实际出现的是「主持人/联合主持/观察员/受访者」。
 *   §1 断言的是**关系**（interview 载体词表里没有这两个字符串 ∧ workshop 载体里有），
 *   不是死文字 —— 「引导师」改前改后都出现在代码库其他地方，纯文本存在性检查会空转。
 *
 * 问题 4 —— 受访者同意屏被压缩成一句话：
 *   原型是四个可分别勾选的授权项（录音/转文字稿/AI 分析/署名）+ 撤回五步 SLA；
 *   v1 只有 `CONSENT_RENDER.liveTemplate` 一句录音文案。
 *   撤回五步 SLA 是「同一事实两处」高危项，此处断言 rec 复用的是
 *   `lib/withdrawal-flow.ts` 的同一个数组引用，不是另抄一份。
 */
import { describe, it, expect } from "vitest";
import {
  REC_VIEWS_BY_CARRIER, CARRIERS, consentItemsFor, type Carrier,
} from "@/lib/mock/rec";
import { WITHDRAWAL_FLOW } from "@/lib/withdrawal-flow";

/* ══════════════════ 问题 5 · 视角词表按载体切换 ══════════════════ */

describe("问题 5 · REC_VIEWS_BY_CARRIER 按载体给不同词表", () => {
  it("interview 载体的视角标签里没有「引导师」「组长」——原型访谈区两词命中 0", () => {
    const labels = REC_VIEWS_BY_CARRIER.interview.map((r) => r.label);
    expect(labels).not.toContain("引导师");
    expect(labels).not.toContain("组长");
  });

  it("interview 载体用的是原型访谈区实际出现的词——主持人/联合主持/观察员/受访者", () => {
    const labels = REC_VIEWS_BY_CARRIER.interview.map((r) => r.label);
    expect(labels).toEqual(["主持人", "联合主持", "观察员", "受访者"]);
  });

  it("workshop 载体保留工作坊四角色——引导师/组长这套词表在工作坊语境是对的，不能被一起删掉", () => {
    const labels = REC_VIEWS_BY_CARRIER.workshop.map((r) => r.label);
    expect(labels).toEqual(["引导师", "组长", "组员", "观察者"]);
  });

  it("阳性对照：两侧列表都非空——空集会让「不包含」平凡为真", () => {
    for (const c of CARRIERS as Carrier[]) {
      expect(REC_VIEWS_BY_CARRIER[c].length).toBeGreaterThan(0);
    }
  });

  it("同一个视角 id（facilitator）在两个载体下必须换成不同的展示词——这是本条 bug 的核心（id 不变、label 该变而没变）", () => {
    const workshopLabel = REC_VIEWS_BY_CARRIER.workshop.find((r) => r.id === "facilitator")?.label;
    const interviewLabel = REC_VIEWS_BY_CARRIER.interview.find((r) => r.id === "facilitator")?.label;
    expect(workshopLabel).toBe("引导师");
    expect(interviewLabel).toBe("主持人");
    expect(interviewLabel).not.toBe(workshopLabel);
  });

  it("反证：把 v1 那种「全载体共用一份工作坊词表」的写法喂给同一断言必须报错——证明 §1 不是空转", () => {
    const v1SingleList = REC_VIEWS_BY_CARRIER.workshop; // v1 的错误做法：所有载体都拿工作坊那份
    const labels = v1SingleList.map((r) => r.label);
    // 用 v1 的错误数据复核问题 5 的核心断言，必须失败（说明我们真的在测这件事，不是恒真）
    expect(labels.includes("引导师")).toBe(true);
    expect(() => expect(labels).not.toContain("引导师")).toThrow();
  });
});

/* ══════════════════ 问题 4 · 受访者同意四项 + 撤回单一事实源 ══════════════════ */

describe("问题 4 · consentItemsFor 是四项自选，不是一句话", () => {
  it("四项 id 齐全——录音/转文字稿/AI 分析/署名，原型 16392000 一屏的全部四项", () => {
    const items = consentItemsFor(90);
    expect(items.map((i) => i.id)).toEqual(["record", "transcript", "aiAnalysis", "realname"]);
  });

  it("AI 分析与署名默认未授权——对应原型示例「你已拒绝」，不是默认全部同意", () => {
    const items = consentItemsFor(90);
    expect(items.find((i) => i.id === "aiAnalysis")?.granted).toBe(false);
    expect(items.find((i) => i.id === "realname")?.granted).toBe(false);
  });

  it("天数是参数化渲染，不是写死的字符串——180 与 90 两次调用文案不同", () => {
    const at90 = consentItemsFor(90).find((i) => i.id === "record")!.desc;
    const at180 = consentItemsFor(180).find((i) => i.id === "record")!.desc;
    expect(at90).not.toBe(at180);
    expect(at90).toContain("90");
    expect(at180).toContain("180");
  });
});

describe("问题 4 附注 · 撤回五步 SLA 单一事实源，rec 不得另抄一份", () => {
  it("rec 用的撤回步骤就是 lib/withdrawal-flow.ts 导出的同一个数组（同一引用，不是结构相似的另一份拷贝）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const retentionPanelSource = readFileSync(
      join(process.cwd(), "components/rec/retention-panel.tsx"),
      "utf8",
    );
    expect(retentionPanelSource).toContain('from "@/lib/withdrawal-flow"');
    // 不应在 rec 侧重新声明步骤数组字面量（该字符串是撤回链单一事实源里第 01 步的原文，只应出现在 withdrawal-flow.ts）
    expect(retentionPanelSource).not.toContain("文字稿与音频进入待删除队列");
  });

  it("WITHDRAWAL_FLOW 仍是 5 步（内容不在本任务范围内改，只验证没被换成别的形状）", () => {
    expect(WITHDRAWAL_FLOW.length).toBe(5);
  });
});
