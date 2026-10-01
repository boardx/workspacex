/**
 * WF05 —— 演示 Workflow `demo-approval:1`（两阶段；第二阶段带人工门；requirements 02 R3 第 6/7 步、R4 A4）。
 *
 * 作用：人工门 approve / deny 的端到端载体（与 demo-brief:1 同一立场：确定性纯计算，不调用模型、不碰外部系统）。
 * `publish` 阶段的"对外发布"只写业务产出行，真实外部副作用由具体 Workflow 在阶段内经 effect-gateway 执行。
 */
import type { LinearWorkflowGraph } from "./workflow-graph-registry";

export const DEMO_APPROVAL_WORKFLOW_KEY = "demo-approval";
export const DEMO_APPROVAL_WORKFLOW_GRAPH_REF = `${DEMO_APPROVAL_WORKFLOW_KEY}:1`;

/** 默认审批人：组织管理员角色；发起人不能自批（allowSelfApproval=false）。 */
export const DEMO_APPROVAL_WORKFLOW_DEFINITION = Object.freeze({
  key: DEMO_APPROVAL_WORKFLOW_KEY,
  version: 1,
  graphRef: DEMO_APPROVAL_WORKFLOW_GRAPH_REF,
  title: "演示：审批后发布",
  inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } },
  stages: [
    { stageId: "draft", title: "起草公告", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
    {
      stageId: "publish",
      title: "发布公告",
      skills: [],
      capabilityCategories: ["mail.send"],
      sideEffect: "external_send",
      humanGate: { approverRoles: ["admin"], approverUserIds: [], allowSelfApproval: false, onDenyStageId: null },
      maxAttempts: 1,
    },
  ],
});

function topicOf(input: Record<string, unknown>): string {
  return typeof input.topic === "string" ? input.topic : "";
}

export function demoApprovalWorkflowGraph(): LinearWorkflowGraph {
  return {
    graphRef: DEMO_APPROVAL_WORKFLOW_GRAPH_REF,
    stages: [
      {
        stageId: "draft",
        work: async (exec) => ({ label: "公告草稿", content: { text: `关于「${topicOf(exec.input)}」的公告草稿。` } }),
      },
      {
        stageId: "publish",
        gatePreview: (exec) => ({
          capabilityCategory: "mail.send",
          targetSystem: "mail",
          summary: `发布关于「${topicOf(exec.input)}」的公告`,
          payloadPreview: { topic: topicOf(exec.input) },
        }),
        work: async (exec) => ({
          label: "已发布公告",
          content: { topic: topicOf(exec.input), approvedBy: exec.approval?.decidedBy ?? null },
        }),
      },
    ],
  };
}
