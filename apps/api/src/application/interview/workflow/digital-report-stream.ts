import {
  DigitalReportStreamEvent,
  type DigitalReportStreamEvent as DigitalReportStreamEventValue,
} from "@repo/contracts/interview";

export type ParsedDigitalReportStreamEvent = DigitalReportStreamEventValue;

export const DIGITAL_REPORT_REQUIRED_HEADINGS = [
  "## 研究范围与方法",
  "## 核心洞察",
  "## 分角色深度分析",
  "## 跨角色主题分析",
  "## 分歧与共识",
  "## 行动建议",
  "## 研究局限与后续验证",
] as const;

export function buildDigitalInterviewReportSystemPrompt(minimumFindings: number): string {
  return `你是一位资深用户研究负责人。请根据已确认的专家 Persona、访谈问题和逐题回答，撰写可供决策会议直接使用的专业定性研究报告。

分析原则：
1. 证据驱动：所有事实、结论和建议必须能回到输入中的具体回答；不得补充外部事实或虚构样本。
2. 画像关联：结合专家的角色、职责、目标、痛点、动机和典型建议，解释“他说了什么、为什么这样说、对决策意味着什么”。
3. 区分层次：明确区分受访者原意、研究者归纳和待验证推论；不要把少量模拟专家回答写成统计结论或行业共识。
4. 原话证据：每个核心洞察至少引用一段简短原话，格式为“专家姓名（角色）：‘原话’”，并在同段说明对应问题。
5. 可操作性：建议使用 P0/P1/P2，写明依据、负责人类型、近期动作、成功信号和风险。
6. 专业表达：客观、克制、具体；识别共性、差异、矛盾、边界条件和反例，禁止空泛总结与同义重复。

输出协议：只输出 NDJSON，每行必须是一个完整 JSON 对象，不要代码围栏、前言或尾注。总报告控制在 4000-8000 个中文字符，优先保证结构完整、证据准确，避免冗长复述。
- 第一行且仅一行：{"type":"meta","title":"具体、决策导向的报告标题","executiveSummary":"包含研究目的、样本边界、3-5项关键发现、主要分歧和首要建议的完整执行摘要"}
- 紧接着输出至少 ${minimumFindings} 个 finding 事件：{"type":"finding","title":"决策型发现标题","summary":"证据、解释、影响和待验证边界","expertId":"输入专家 ID","questionId":"输入问题 ID"}。先输出 finding，确保关键发现优先送达。
- 最后严格按顺序输出以下 7 个 section 事件，每个事件的 markdown 必须以对应二级标题开头，并包含充分但简洁的小节、证据和分析：
${DIGITAL_REPORT_REQUIRED_HEADINGS.map((heading, index) => `${index + 1}. ${heading}`).join("\n")}

章节内容要求：
- “研究范围与方法”：主题、样本/Persona 构成、访谈覆盖、分析方法、证据边界；明确这是数字专家模拟访谈，结论需真人研究验证。
- “核心洞察”：3-5 个按重要性排序的洞察，每项包含证据原话、画像解释、影响与置信边界。
- “分角色深度分析”：逐位专家写核心关注、痛点、显性需求、深层动机、行为/决策逻辑和关键引语，不得遗漏任何专家。
- “跨角色主题分析”：围绕主题串联现状、原因、影响、理想状态，比较不同角色的共同模式和差异。
- “分歧与共识”：分别列出一致观点、冲突观点、冲突产生的角色/资源/目标原因，以及需要补充验证的问题。
- “行动建议”：给出 P0/P1/P2 建议及证据映射、近期动作、成功信号和实施风险，不得提出与访谈证据无关的通用方案。
- “研究局限与后续验证”：样本与模拟边界、不能下的结论、真人访谈/数据验证计划和优先追问。

每条 finding 必须原样使用输入中的 expertId 和 questionId，且 summary 不得只复述回答，必须包含证据解释与决策影响。`;
}

/**
 * Incremental report-event decoder.
 *
 * Providers occasionally pretty-print JSON or wrap otherwise valid NDJSON in a
 * Markdown fence. Extracting balanced top-level objects keeps streaming intact
 * while making those harmless presentation differences non-fatal.
 */
export class DigitalReportNdjsonDecoder {
  private pending = "";
  private scanIndex = 0;
  private objectStart = -1;
  private depth = 0;
  private inString = false;
  private escaped = false;

  push(delta: string): readonly ParsedDigitalReportStreamEvent[] {
    this.pending += delta;
    const events: ParsedDigitalReportStreamEvent[] = [];
    let consumedThrough = 0;
    for (let index = this.scanIndex; index < this.pending.length; index += 1) {
      const character = this.pending[index];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (character === "\\") this.escaped = true;
        else if (character === '"') this.inString = false;
        continue;
      }
      if (character === '"' && this.depth > 0) {
        this.inString = true;
      } else if (character === "{") {
        if (this.depth === 0) this.objectStart = index;
        this.depth += 1;
      } else if (character === "}" && this.depth > 0) {
        this.depth -= 1;
        if (this.depth === 0 && this.objectStart >= 0) {
          events.push(this.parseEvent(this.pending.slice(this.objectStart, index + 1)));
          consumedThrough = index + 1;
          this.objectStart = -1;
        }
      }
    }
    this.scanIndex = this.pending.length;
    if (consumedThrough > 0) {
      this.pending = this.pending.slice(consumedThrough);
      this.scanIndex -= consumedThrough;
      if (this.objectStart >= 0) this.objectStart -= consumedThrough;
    }
    return events;
  }

  finish(): readonly ParsedDigitalReportStreamEvent[] {
    if (this.depth !== 0 || this.objectStart >= 0) {
      throw new SyntaxError("incomplete report stream JSON object");
    }
    this.pending = "";
    this.scanIndex = 0;
    return [];
  }

  private parseEvent(json: string): ParsedDigitalReportStreamEvent {
    try {
      return DigitalReportStreamEvent.parse(JSON.parse(json));
    } catch (error) {
      throw new SyntaxError("invalid report stream event", { cause: error });
    }
  }
}
