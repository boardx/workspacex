/**
 * Agent instructions ↔ 真实门控 的一致性。
 *
 * ## 为什么这条测试必须存在
 *
 * instructions 里现在写着「三道门由人来点，你点不了也绕不过去」。这句话今天是真的，
 * 因为 `state-machine.ts` 的 `AGENT_TRANSITIONS` 里确实没有通向那两个阶段的边。
 *
 * 但这两处是**分开的**：有人为了让某个流程跑通，在转移表里加一条捷径，
 * instructions 不会因此变成一句谎话——它会**继续原样写着**，而且写得越具体越可信。
 * 那正是 AGENTS.md 点名的「静态痕迹 ≠ 动态事实」：
 * 「代码注释说今天没有这条路径 ≠ 今天真没有」。
 *
 * 所以这里把"文案怎么说"与"系统怎么做"绑在一起：任一侧变了，这里红。
 */
import { describe, expect, it } from "vitest";
import { researchWorkflow as C } from "@repo/contracts";
import { TEAM3_AGENT_INSTRUCTIONS } from "../../scripts/backfill-team3-agent";
import { decideAdvance } from "../../src/domain/research-workflow/state-machine";

describe("instructions 对门的描述与真实门控一致", () => {
  it("instructions 声称 Agent 绕不过门 —— 而真实转移表里确实没有通向门控阶段的边", () => {
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("绕不过去");

    // 这才是那句话的**事实依据**：穷举所有起点，确认到不了那两个阶段。
    for (const gated of ["materials_approved", "graph_published"] as const) {
      for (const from of C.RESEARCH_PHASES) {
        const d = decideAdvance(
          {
            phase: from,
            materials: [{ verdict: "accepted", attempts: 0 }],
            lineage: { materialBatchId: "b", fieldSchemeVersion: 9, logicVersion: 9, publishedGraphVersion: 9 },
          },
          gated,
        );
        expect(d.ok, `instructions 说绕不过去，但 ${from} → ${gated} 竟然放行了`).toBe(false);
      }
    }
  });

  it("三道硬门在 instructions 里都被点名（少写一道，用户就不知道还要确认它）", () => {
    for (const gate of C.HARD_GATES) {
      expect(TEAM3_AGENT_INSTRUCTIONS, `硬门 ${gate} 没在 instructions 里出现`).toContain(
        C.GATE_LABELS[gate],
      );
    }
  });

  it("重采上限写的数字与契约常量一致（两处声明同一个数字迟早对不上）", () => {
    // 契约是 2，文案里写的是"最多重来两次"。数字换了而文案没跟上 ⇒ 这里红。
    expect(C.MAX_COLLECTION_ATTEMPTS).toBe(2);
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("最多");
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("两次");
  });

  it("明确禁止 Agent 宣称自己已经发布/进入下一步", () => {
    // 模型最容易做的事就是说「好的，我已经发布了第 2 版」——而那件事只有人点门才会发生。
    // 说了会造成用户以为流程走完了，其实卡在原地。
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("不要声称");
  });

  it("要求预测必须可验证（「前景广阔」这种话第三步没法比对）", () => {
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("可验证的预测");
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("兑现");
  });

  it("画图仍然走 mermaid 围栏，且仍然明确不要调画布工具（2026-09-15 修过的那个错）", () => {
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("```mermaid");
    expect(TEAM3_AGENT_INSTRUCTIONS).toContain("不要去调画布类工具");
  });
});
