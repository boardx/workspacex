/**
 * TOOLCHAIN-01 signoff 原型 mock —— 活体 run 工具调用链折叠式展示的各场景样本。
 *
 * ⚠ 纯前端 mock（签核第 ① 件材料），不接后端。这里造的 `steps` 严格照活体
 *   `AgentRunView["steps"]` 的真实字段形状（`@repo/contracts` wave2Runtime.AgentRunStep）：
 *   每个 tool_call step 有 toolName / status / toolArgsSummary / toolResultSummary /
 *   planningNote（任一可为 null，为 null 组件就不渲染那行）+ startedAt/endedAt（ISO 串）。
 *
 * mock 力求「像真的」：真实技能工具名、真实参数摘要（含 `{}` 空参与长 pattern）、
 *   真实结果体量、真实耗时跨度（用于「思考了 X 秒」推导）。
 *
 * 五态（scene）：
 *   collapsed —— 3 个工具全成功（主打屏，证明「不再占底部一大块」）
 *   expanded  —— 同 collapsed 数据，预览页令其默认展开态并列展示
 *   failure   —— 3 个工具含 1 个失败（收起态要能表达「有失败」，展开态失败行走 destructive）
 *   no-tools  —— run 有 step 但无工具调用（模型直接作答）
 *   single    —— 只调用 1 个工具（摘要「调用了 1 个工具」）
 */
import type { AgentRunView } from "@/lib/agent-run";

type Step = AgentRunView["steps"][number];

export const TOOLCHAIN_SCENES = [
  "collapsed", "expanded", "failure", "no-tools", "single",
  // #742 Gap 1 + Gap 4（CopilotKit 对标）：进行中态 + 四个 per-tool 定制卡片并列展示。
  "in-progress-per-tool",
] as const;
export type ToolChainScene = (typeof TOOLCHAIN_SCENES)[number];

export function resolveToolChainScene(raw?: string): ToolChainScene {
  return (TOOLCHAIN_SCENES as readonly string[]).includes(raw ?? "")
    ? (raw as ToolChainScene)
    : "collapsed";
}

/** 非工具的骨架 step（accepted / context_built / model_called / chat_writeback）——
 *  它们参与「思考了 X 秒」的时间跨度，但组件只渲染 tool_call。 */
function frameStep(kind: Step["kind"], startedAt: string, endedAt: string): Step {
  return {
    kind,
    status: "succeeded",
    startedAt,
    endedAt,
    inputDigest: null,
    outputDigest: null,
    failureCode: null,
    toolName: null,
    toolArgsSummary: null,
    toolResultSummary: null,
    planningNote: null,
  };
}

function toolStep(input: {
  status?: Step["status"];
  startedAt: string;
  endedAt: string;
  toolName: string;
  toolArgsSummary: string | null;
  toolResultSummary: string | null;
  planningNote?: string | null;
  failureCode?: Step["failureCode"];
}): Step {
  return {
    kind: "tool_call",
    status: input.status ?? "succeeded",
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    inputDigest: "sha256:…",
    outputDigest: "sha256:…",
    failureCode: input.failureCode ?? null,
    toolName: input.toolName,
    toolArgsSummary: input.toolArgsSummary,
    toolResultSummary: input.toolResultSummary,
    planningNote: input.planningNote ?? null,
  };
}

// 一段真实感的三工具成功链：查组织技能 → 检索知识库 → 汇总为草稿。
const T0 = "2026-08-12T14:12:03.000Z";
function threeToolSuccess(): Step[] {
  return [
    frameStep("accepted", T0, "2026-08-12T14:12:03.100Z"),
    frameStep("context_built", "2026-08-12T14:12:03.100Z", "2026-08-12T14:12:03.480Z"),
    frameStep("model_called", "2026-08-12T14:12:03.480Z", "2026-08-12T14:12:04.010Z"),
    toolStep({
      startedAt: "2026-08-12T14:12:04.010Z",
      endedAt: "2026-08-12T14:12:04.560Z",
      toolName: "list_org_skills",
      toolArgsSummary: "{}",
      toolResultSummary: "返回 12 个已启用技能（market-entry-analysis、competitor-scan、pricing-model…）",
      planningNote: "先看看这个组织里有哪些现成技能能直接复用，避免重复造轮子。",
    }),
    toolStep({
      startedAt: "2026-08-12T14:12:04.560Z",
      endedAt: "2026-08-12T14:12:05.240Z",
      toolName: "search_knowledge_base",
      toolArgsSummary: 'query="东南亚 SaaS 定价 基准"，top_k=8，filters={space:"market-research"}',
      toolResultSummary: "命中 8 段，最相关来自《2026 Q2 区域定价报告》第 14 页与访谈转录 03:12–05:40",
      planningNote: "定价假设需要有出处，去知识库拉最近的区域报告和访谈原文当引用。",
    }),
    toolStep({
      startedAt: "2026-08-12T14:12:05.240Z",
      endedAt: "2026-08-12T14:12:06.230Z",
      toolName: "draft_document",
      toolArgsSummary: 'title="东南亚市场进入 · 定价建议 v1"，sections=4',
      toolResultSummary: "已生成 4 节草稿（约 1,800 字），待落地为产物",
      planningNote: null, // 模型这一步没有先说话，直接调用——不编占位
    }),
    frameStep("chat_writeback", "2026-08-12T14:12:06.230Z", "2026-08-12T14:12:06.480Z"),
  ];
}

function threeToolWithFailure(): Step[] {
  return [
    frameStep("accepted", T0, "2026-08-12T14:12:03.120Z"),
    frameStep("context_built", "2026-08-12T14:12:03.120Z", "2026-08-12T14:12:03.500Z"),
    frameStep("model_called", "2026-08-12T14:12:03.500Z", "2026-08-12T14:12:04.050Z"),
    toolStep({
      startedAt: "2026-08-12T14:12:04.050Z",
      endedAt: "2026-08-12T14:12:04.620Z",
      toolName: "list_org_skills",
      toolArgsSummary: "{}",
      toolResultSummary: "返回 12 个已启用技能",
      planningNote: "先枚举可用技能。",
    }),
    toolStep({
      status: "failed",
      startedAt: "2026-08-12T14:12:04.620Z",
      endedAt: "2026-08-12T14:12:09.640Z",
      toolName: "fetch_external_market_data",
      toolArgsSummary: 'source="statista"，region="SEA"，year=2026',
      toolResultSummary: "上游 502，5.0 秒后仍未响应；该技能对外网依赖不可用，未产出数据",
      planningNote: "需要一份第三方市场规模数据补全测算。",
      failureCode: "SKILL_VERSION_UNAVAILABLE",
    }),
    toolStep({
      startedAt: "2026-08-12T14:12:09.640Z",
      endedAt: "2026-08-12T14:12:10.410Z",
      toolName: "search_knowledge_base",
      toolArgsSummary: 'query="东南亚 SaaS 市场规模"，top_k=6',
      toolResultSummary: "改用内部知识库兜底，命中 6 段，已在草稿中标注「数据来源为内部估算」",
      planningNote: "外部源挂了，退回用内部资料，并如实标注出处降级。",
    }),
    frameStep("chat_writeback", "2026-08-12T14:12:10.410Z", "2026-08-12T14:12:10.700Z"),
  ];
}

function singleTool(): Step[] {
  return [
    frameStep("accepted", T0, "2026-08-12T14:12:03.080Z"),
    frameStep("context_built", "2026-08-12T14:12:03.080Z", "2026-08-12T14:12:03.360Z"),
    frameStep("model_called", "2026-08-12T14:12:03.360Z", "2026-08-12T14:12:03.900Z"),
    toolStep({
      startedAt: "2026-08-12T14:12:03.900Z",
      endedAt: "2026-08-12T14:12:04.780Z",
      toolName: "search_knowledge_base",
      toolArgsSummary: 'query="上季度 NPS 变化 归因"，top_k=5',
      toolResultSummary: "命中 5 段，最相关来自《客户成功月报 · 7 月》",
      planningNote: "问题只需要一次检索就能答，直接查知识库。",
    }),
    frameStep("chat_writeback", "2026-08-12T14:12:04.780Z", "2026-08-12T14:12:05.010Z"),
  ];
}

// 模型直接作答：有骨架 step，但没有任何 tool_call。
function noTools(): Step[] {
  return [
    frameStep("accepted", T0, "2026-08-12T14:12:03.060Z"),
    frameStep("context_built", "2026-08-12T14:12:03.060Z", "2026-08-12T14:12:03.300Z"),
    frameStep("model_called", "2026-08-12T14:12:03.300Z", "2026-08-12T14:12:04.900Z"),
    frameStep("chat_writeback", "2026-08-12T14:12:04.900Z", "2026-08-12T14:12:05.120Z"),
  ];
}

// #742 Gap 1 + Gap 4：write_todos → search_documents → read_document 全部已完成，
// lookup_time 还挂在 in_progress——同一屏证明「进行中态可见」+「至少两个工具的定制渲染」。
function inProgressPerTool(): Step[] {
  return [
    frameStep("accepted", T0, "2026-08-24T09:00:00.100Z"),
    frameStep("context_built", "2026-08-24T09:00:00.100Z", "2026-08-24T09:00:00.400Z"),
    frameStep("model_called", "2026-08-24T09:00:00.400Z", "2026-08-24T09:00:00.900Z"),
    toolStep({
      startedAt: "2026-08-24T09:00:00.900Z",
      endedAt: "2026-08-24T09:00:01.200Z",
      toolName: "write_todos",
      toolArgsSummary: JSON.stringify({
        todos: [
          { content: "搜索相关文档", status: "completed" },
          { content: "读取最相关的一份", status: "completed" },
          { content: "综合结论作答", status: "in_progress" },
        ],
      }),
      toolResultSummary: "todos updated",
      planningNote: "先列一下计划，再逐步执行。",
    }),
    toolStep({
      startedAt: "2026-08-24T09:00:01.200Z",
      endedAt: "2026-08-24T09:00:01.900Z",
      toolName: "search_documents",
      toolArgsSummary: JSON.stringify({ query: "东南亚 SaaS 定价" }),
      toolResultSummary: "找到 3 份文档：A.md B.md C.md",
      planningNote: "先搜索相关文档。",
    }),
    toolStep({
      startedAt: "2026-08-24T09:00:01.900Z",
      endedAt: "2026-08-24T09:00:02.500Z",
      toolName: "read_document",
      toolArgsSummary: JSON.stringify({ path: "A.md" }),
      toolResultSummary: "A.md 内容：多步执行取证样例正文——搜索命中的第一份文档。",
      planningNote: "基于搜索结果，读取最相关的 A.md。",
    }),
    // 进行中——还没有 toolResultSummary，账本里是 in_progress。
    toolStep({
      status: "in_progress",
      startedAt: "2026-08-24T09:00:02.500Z",
      endedAt: "2026-08-24T09:00:02.500Z",
      toolName: "lookup_time",
      toolArgsSummary: "{}",
      toolResultSummary: null,
      planningNote: "顺便确认一下当前时间。",
    }),
  ];
}

export function toolChainSteps(scene: ToolChainScene): Step[] {
  switch (scene) {
    case "collapsed":
    case "expanded":
      return threeToolSuccess();
    case "failure":
      return threeToolWithFailure();
    case "no-tools":
      return noTools();
    case "single":
      return singleTool();
    case "in-progress-per-tool":
      return inProgressPerTool();
  }
}

/** 预览页据此决定该 scene 是否默认展开（expanded 屏令其展开，其余收起）。 */
export function sceneDefaultOpen(scene: ToolChainScene): boolean {
  return scene === "expanded" || scene === "in-progress-per-tool";
}

export const SCENE_LABEL: Record<ToolChainScene, string> = {
  collapsed: "collapsed 收起（主打）",
  expanded: "expanded 展开",
  failure: "failure 含失败",
  "no-tools": "no-tools 直接作答",
  single: "single 单工具",
  "in-progress-per-tool": "in-progress-per-tool 进行中 + 按工具定制",
};
