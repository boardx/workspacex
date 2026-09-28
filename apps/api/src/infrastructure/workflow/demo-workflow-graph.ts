/**
 * WF03 —— 演示 Workflow `demo-brief:1`（三阶段、无副作用、无人工门；requirements 02 R4 A3）。
 *
 * 作用：运行时（start / 事件 / SSE / 崩溃恢复）的端到端载体。阶段工作是确定性的纯计算，产出写
 * workflow_stage_outputs；不调用模型、不碰外部系统。`stageDelayMs`（≤ 5000）让演示/测试能观察到运行中状态。
 */
import type { StageExecution } from "../../application/workflow/run-instance";
import type { LinearWorkflowGraph } from "./workflow-graph-registry";

export const DEMO_WORKFLOW_KEY = "demo-brief";
export const DEMO_WORKFLOW_GRAPH_REF = `${DEMO_WORKFLOW_KEY}:1`;
export const DEMO_WORKFLOW_STAGES = ["collect", "draft", "finalize"] as const;

/** 与图对应的 Definition 元数据（发布时用；阶段 id 与图节点一一对应）。 */
export const DEMO_WORKFLOW_DEFINITION = Object.freeze({
  key: DEMO_WORKFLOW_KEY,
  version: 1,
  graphRef: DEMO_WORKFLOW_GRAPH_REF,
  title: "演示：主题简报",
  inputSchema: {
    type: "object",
    required: ["topic"],
    properties: { topic: { type: "string" }, stageDelayMs: { type: "integer" } },
  },
  stages: [
    { stageId: "collect", title: "收集要点", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
    { stageId: "draft", title: "起草简报", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
    { stageId: "finalize", title: "定稿", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
  ],
});

async function pace(exec: StageExecution): Promise<void> {
  const raw = exec.input.stageDelayMs;
  const ms = typeof raw === "number" && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 5000) : 0;
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

function topicOf(exec: StageExecution): string {
  return typeof exec.input.topic === "string" ? exec.input.topic : "";
}

export function demoWorkflowGraph(): LinearWorkflowGraph {
  return {
    graphRef: DEMO_WORKFLOW_GRAPH_REF,
    stages: [
      {
        stageId: "collect",
        work: async (exec) => {
          await pace(exec);
          const topic = topicOf(exec);
          return { label: "要点", content: { points: [`${topic}：背景`, `${topic}：现状`, `${topic}：下一步`] } };
        },
      },
      {
        stageId: "draft",
        work: async (exec) => {
          await pace(exec);
          return { label: "简报草稿", content: { text: `关于「${topicOf(exec)}」的简报草稿（三段）。` } };
        },
      },
      {
        stageId: "finalize",
        work: async (exec) => {
          await pace(exec);
          return { label: "简报定稿", content: { text: `关于「${topicOf(exec)}」的简报定稿。`, final: true } };
        },
      },
    ],
  };
}
