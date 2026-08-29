/**
 * Phase 14 · 需求 2 signoff 原型 mock —— 工具执行结果结构化摘要（量化信息）的各场景样本。
 *
 * ⚠ 纯前端 mock（签核第 ① 件材料），不接后端。`steps` 严格照活体 `AgentRunView["steps"]`
 *   真实字段形状；`resultSummaries` 是**与后端协议扩展对齐的预期形状**
 *   （`{ rows?, bytes?, hits? }`，见 `lib/tool-result-summary.ts` 头注），按 tool_call 顺序对齐。
 *
 * 三场景，都用同一条「读取密集型」run（检索 → 读大日志 → 查数据库表 → 起草），只有
 * `resultSummaries` 不同，好让人类逐屏核对「有摘要显量化 / 没摘要优雅回退」：
 *   with-summary —— 三个读取类工具都带量化摘要（命中 / 行数+字节 / 行数），起草工具无摘要
 *   mixed        —— 只有部分工具带摘要，其余回退纯文字（证明混合场景不串味）
 *   fallback     —— 完全不传 resultSummaries（现状），逐字回退到既有文本描述
 */
import type { AgentRunView } from "@/lib/agent-run";
import type { ToolResultSummary } from "@/lib/tool-result-summary";

type Step = AgentRunView["steps"][number];

export const SUMMARY_SCENES = ["with-summary", "mixed", "fallback"] as const;
export type SummaryScene = (typeof SUMMARY_SCENES)[number];

export function resolveSummaryScene(raw?: string): SummaryScene {
  return (SUMMARY_SCENES as readonly string[]).includes(raw ?? "")
    ? (raw as SummaryScene)
    : "with-summary";
}

export const SUMMARY_SCENE_LABEL: Record<SummaryScene, string> = {
  "with-summary": "with-summary 全部带量化摘要",
  mixed: "mixed 部分带、部分回退",
  fallback: "fallback 全部回退（现状）",
};

function frameStep(kind: Step["kind"], startedAt: string, endedAt: string): Step {
  return {
    kind, status: "succeeded", startedAt, endedAt,
    inputDigest: null, outputDigest: null, failureCode: null,
    toolName: null, toolArgsSummary: null, toolResultSummary: null, planningNote: null,
  };
}

function toolStep(input: {
  startedAt: string; endedAt: string; toolName: string;
  toolArgsSummary: string | null; toolResultSummary: string | null; planningNote?: string | null;
}): Step {
  return {
    kind: "tool_call", status: "succeeded",
    startedAt: input.startedAt, endedAt: input.endedAt,
    inputDigest: "sha256:…", outputDigest: "sha256:…", failureCode: null,
    toolName: input.toolName, toolArgsSummary: input.toolArgsSummary,
    toolResultSummary: input.toolResultSummary, planningNote: input.planningNote ?? null,
  };
}

const T0 = "2026-08-28T10:30:00.000Z";

/** 一条读取密集型 run：检索知识库 → 读一份大日志 → 查数据库表 → 起草汇总。 */
export function summarySteps(): Step[] {
  return [
    frameStep("accepted", T0, "2026-08-28T10:30:00.120Z"),
    frameStep("context_built", "2026-08-28T10:30:00.120Z", "2026-08-28T10:30:00.560Z"),
    frameStep("model_called", "2026-08-28T10:30:00.560Z", "2026-08-28T10:30:01.230Z"),
    toolStep({
      startedAt: "2026-08-28T10:30:01.230Z",
      endedAt: "2026-08-28T10:30:02.010Z",
      toolName: "search_knowledge_base",
      toolArgsSummary: 'query="华东区 Q3 销售 下滑 归因"，top_k=12',
      toolResultSummary: "在《华东区 Q3 销售复盘》《渠道健康度周报》等来源中检索到相关片段",
      planningNote: "先把和「华东区 Q3 下滑」相关的资料都捞出来，确定归因方向。",
    }),
    toolStep({
      startedAt: "2026-08-28T10:30:02.010Z",
      endedAt: "2026-08-28T10:30:03.480Z",
      toolName: "read_document",
      toolArgsSummary: JSON.stringify({ path: "logs/sales-events-2026Q3.csv" }),
      toolResultSummary: "已读取华东区 Q3 全量销售事件明细，用于逐单归因",
      planningNote: "把 Q3 的成交/流失事件明细整份读进来，才能做逐单归因。",
    }),
    toolStep({
      startedAt: "2026-08-28T10:30:03.480Z",
      endedAt: "2026-08-28T10:30:04.360Z",
      toolName: "query_table",
      toolArgsSummary: 'SELECT region, month, SUM(amount) FROM sales WHERE region="华东" AND quarter="2026Q3" GROUP BY month',
      toolResultSummary: "按月汇总华东区 Q3 销售额，与去年同期对比得到环比/同比缺口",
      planningNote: "再用聚合查询把「下滑」量化到每个月、每条产品线。",
    }),
    toolStep({
      startedAt: "2026-08-28T10:30:04.360Z",
      endedAt: "2026-08-28T10:30:05.620Z",
      toolName: "draft_document",
      toolArgsSummary: 'title="华东区 Q3 销售下滑归因 · 初稿"，sections=5',
      toolResultSummary: "已生成 5 节归因初稿（约 2,300 字），待落地为产物",
      planningNote: null,
    }),
    frameStep("chat_writeback", "2026-08-28T10:30:05.620Z", "2026-08-28T10:30:05.900Z"),
  ];
}

/**
 * 按 tool_call 顺序对齐的结构化量化摘要（第 i 个 tool step 对应 `[i]`）。
 * tool step 顺序：0 检索 · 1 读日志 · 2 查表 · 3 起草。
 */
export function summaryResultSummaries(scene: SummaryScene): readonly (ToolResultSummary | null)[] | undefined {
  switch (scene) {
    case "with-summary":
      return [
        { hits: 12 },                          // 检索命中 12 条
        { rows: 41_208, bytes: 8_820_326 },    // 读日志：41,208 行 · 8.4 MB
        { rows: 3, hits: 3 },                  // 查表：3 行汇总结果（按月）
        null,                                  // 起草：写入类工具，无量化摘要 → 回退
      ];
    case "mixed":
      return [
        { hits: 12 },                          // 检索有
        null,                                  // 读日志无 → 回退纯文字
        { rows: 3 },                           // 查表有
        null,                                  // 起草无
      ];
    case "fallback":
    default:
      return undefined;                        // 完全不传 → 全部回退（现状行为）
  }
}
