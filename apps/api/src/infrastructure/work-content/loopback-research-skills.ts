/**
 * Phase 20 CT03 —— 研究线 Skill 的回环执行器（确定性；05 号 R4 E11：外部工具不可用时评测用桩）。
 *
 * 不调用真实模型：每个 Skill 按其 §7 产出 schema 做确定性变换。检索（S003）委托给注入的 `web.search`
 * 桩工具；综合/评审/风险只引用检索真实返回的材料 ref，从不凭空造证据。
 */
import type { PinnedSkillExecutorPort } from "../../application/work-content/research-to-brief";

export interface ResearchSearchTool {
  search(query: string): Promise<{ ref: string; text: string }[]>;
}

type Material = { ref: string; text: string };

function materialsOf(input: Record<string, unknown>): Material[] {
  return Array.isArray(input.materials) ? (input.materials as Material[]) : [];
}

export class LoopbackResearchSkillExecutor implements PinnedSkillExecutorPort {
  constructor(private readonly tool: ResearchSearchTool) {}

  async run(call: { skillId: string; semanticVersion: string; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const { input } = call;
    const question = typeof input.question === "string" ? input.question : "";
    switch (call.skillId) {
      case "S003":
        return { materials: await this.tool.search(question) };
      case "S063":
        return {
          claims: materialsOf(input).map((m) => ({ text: `${question}：${m.text}`, evidenceRefs: [m.ref], confidence: "medium" })),
        };
      case "S171":
        // 评审本身在领域函数 auditClaims 里强制；回环只原样转交。
        return { claims: Array.isArray(input.claims) ? input.claims : [] };
      case "S020":
        return { title: `研究简报：${question}` };
      case "S010": {
        const first = materialsOf(input)[0];
        return { risks: first ? [{ text: `证据覆盖有限（仅 ${materialsOf(input).length} 条材料）`, evidenceRefs: [first.ref], confidence: "low" }] : [] };
      }
      default:
        throw new Error(`loopback research executor has no skill ${call.skillId}`);
    }
  }
}
