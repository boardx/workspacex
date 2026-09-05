/**
 * Phase 14 — agent-kernel-unification UI 先行 mock 数据。
 *
 * 纯前端 mock，不接后端。数据量级、字段完整度、边界值刻意贴近真实：
 * 计划有 6 个 todo（含依赖与已完成态）、进度流有多种工具调用与真实 diff、
 * 产出物有 3 个版本、错误卡带真实堆栈。让束级 sign-off 能看出信息密度问题。
 *
 * 事件类型命名对齐 00-overview 全局约束「事件模型对齐 AG-UI 协议」的意图，
 * 但此处只是渲染用的 mock 形状，不是协议契约本身（契约属于 packages/contracts）。
 */

export type AgentKernelUnit =
  | "01-plan-confirmation"
  | "02-progress-stream"
  | "03-tool-permission"
  | "04-interjection"
  | "05-artifacts"
  | "06-error-card"
  | "07-reconnect"
  | "08-paused";

export interface AgentKernelUnitMeta {
  readonly key: AgentKernelUnit;
  readonly label: string;
  /** 对应需求文件与 R8 小节 */
  readonly source: string;
  /** 触发它的 run 状态 */
  readonly runStatus: string;
}

export const AGENT_KERNEL_UNITS: readonly AgentKernelUnitMeta[] = [
  { key: "01-plan-confirmation", label: "计划确认卡片", source: "03-plan-mode R8 · awaiting_plan_confirmation", runStatus: "awaiting_plan_confirmation" },
  { key: "02-progress-stream", label: "执行进度流", source: "03-plan-mode / 02-streaming R8 · running", runStatus: "running" },
  { key: "03-tool-permission", label: "工具权限确认弹层", source: "03-plan-mode R8 · awaiting_tool_permission", runStatus: "awaiting_tool_permission" },
  { key: "04-interjection", label: "中途插话入口", source: "04-artifacts-steering R8 · running", runStatus: "running" },
  { key: "05-artifacts", label: "产出物面板", source: "04-artifacts-steering R8 · Artifact 版本历史", runStatus: "running" },
  { key: "06-error-card", label: "错误状态卡片", source: "05-error-observability R8 · failed", runStatus: "failed" },
  { key: "07-reconnect", label: "断线重连提示", source: "02-streaming R8 · reconnect toast", runStatus: "running" },
  { key: "08-paused", label: "暂停态（主动 / 保护性）", source: "02-streaming R6 · paused", runStatus: "paused" },
];

// ── 01 计划确认卡片 ────────────────────────────────────────────────
export type TodoRisk = "L0" | "L1" | "L2";

export interface PlanTodo {
  readonly id: string;
  content: string;
  /** 该步骤最高风险等级（决定执行时是否会触发权限确认） */
  readonly risk: TodoRisk;
  /** 依赖的前置步骤 id，删除前置会让本步骤失去依赖（E2 校验） */
  readonly dependsOn?: string;
}

export const MOCK_PLAN_TODOS: readonly PlanTodo[] = [
  { id: "t1", content: "读取 requirements/ 下现有季度营收 CSV 与去年对比表", risk: "L0" },
  { id: "t2", content: "抽取每个区域的同比增长率，标注异常区域", risk: "L0", dependsOn: "t1" },
  { id: "t3", content: "生成图表数据并写入 charts/revenue-q3.json", risk: "L1", dependsOn: "t2" },
  { id: "t4", content: "渲染 PDF 报告 reports/q3-summary.pdf（含 4 张图表）", risk: "L1", dependsOn: "t3" },
  { id: "t5", content: "运行 scripts/validate-report.sh 校验 PDF 完整性", risk: "L2", dependsOn: "t4" },
  { id: "t6", content: "把报告上传到组织共享盘 /shared/finance/", risk: "L2", dependsOn: "t4" },
];

export const RISK_LABEL: Record<TodoRisk, { text: string; hint: string }> = {
  L0: { text: "只读", hint: "无副作用，自动执行" },
  L1: { text: "可撤销", hint: "写/改文件，有版本历史可回滚，自动执行但带 diff" },
  L2: { text: "高风险", hint: "不可逆或外发，执行前需你确认" },
};

// ── 02 执行进度流 ──────────────────────────────────────────────────
export type StepStatus = "done" | "running" | "queued" | "error";

export interface ProgressStep {
  readonly id: string;
  readonly tool: string;
  /** 人类可读意图（planningNote），不是工具原始名 */
  readonly planningNote: string;
  readonly risk: TodoRisk;
  readonly status: StepStatus;
  readonly durationMs?: number;
  /** L1 操作的完整 diff（write_file / edit_file） */
  readonly diff?: { path: string; added: number; removed: number; body: string };
  /** L0 读操作的结果摘要 */
  readonly resultSummary?: string;
}

export const MOCK_PROGRESS_STEPS: readonly ProgressStep[] = [
  {
    id: "s1", tool: "read_file", planningNote: "读取 Q3 营收 CSV 摸清列结构",
    risk: "L0", status: "done", durationMs: 420,
    resultSummary: "12 列 × 480 行；区域列 region 有 6 个枚举值",
  },
  {
    id: "s2", tool: "grep", planningNote: "定位去年同期对比表所在文件",
    risk: "L0", status: "done", durationMs: 180,
    resultSummary: "命中 data/2024-q3-baseline.csv",
  },
  {
    id: "s3", tool: "write_file", planningNote: "把抽取出的图表数据写成 JSON 供渲染",
    risk: "L1", status: "done", durationMs: 90,
    diff: {
      path: "charts/revenue-q3.json", added: 48, removed: 0,
      body:
`+{
+  "series": [
+    { "region": "华东", "yoy": 0.182, "flag": "normal" },
+    { "region": "华北", "yoy": -0.043, "flag": "watch" },
+    { "region": "华南", "yoy": 0.211, "flag": "normal" },
+    { "region": "西南", "yoy": 0.077, "flag": "normal" }
+  ]
+}`,
    },
  },
  {
    id: "s4", tool: "edit_file", planningNote: "给报告模板补上异常区域的红色标注段落",
    risk: "L1", status: "running", durationMs: undefined,
    diff: {
      path: "reports/templates/q3-summary.md", added: 6, removed: 2,
      body:
`@@ 报告模板 · 区域小结 @@
-## 区域表现
-各区域整体稳健。
+## 区域表现
+华东、华南同比增长强劲（+18.2% / +21.1%）。
+> ⚠ 华北同比下滑 4.3%，已标注为需关注区域，
+> 建议在结论段单独说明原因与应对措施。`,
    },
  },
  {
    id: "s5", tool: "render_pdf", planningNote: "渲染最终 PDF 报告",
    risk: "L1", status: "queued",
  },
  {
    id: "s6", tool: "bash_exec", planningNote: "运行校验脚本确认 PDF 未损坏",
    risk: "L2", status: "queued",
  },
];

// ── 03 工具权限确认弹层 ────────────────────────────────────────────
export const MOCK_PERMISSION_REQUEST = {
  tool: "bash_exec",
  risk: "L2" as TodoRisk,
  /** agent 想做什么 */
  intent: "运行报告校验脚本，确认刚生成的 PDF 页数与图表完整、无渲染损坏",
  /** 为什么（关联到哪个计划步骤） */
  rationale: "计划第 5 步依赖此校验通过才能进入上传；跳过校验可能把损坏文件外发",
  /** 完整命令内容，不是截断摘要（R6 后置条件） */
  command: "bash scripts/validate-report.sh reports/q3-summary.pdf --strict --expect-pages=8",
  affects: "在沙箱内执行；只读取该 PDF，不修改仓库文件，不联网",
};

// ── 05 产出物面板 ──────────────────────────────────────────────────
// 与 packages/contracts/src/artifact.ts 的 ArtifactVersion（phase-00 通用文件版本模型）
// 字段形状不同（这里是 agent-kernel 产出物专用的 mock 视图），改名避免同名误导——
// 同名但字段对不上比不同名更误导（contract-design.md §五-3）。
export interface AgentKernelArtifactVersionPreview {
  readonly version: number;
  readonly label: string;
  readonly createdAt: string;
  readonly producedByRunId: string;
  readonly producedByStepId: string;
  readonly sizeKb: number;
  readonly changeNote: string;
}

// 同上，与 artifact.ts 的 Artifact 改名避免误导同名。
export interface AgentKernelArtifactPreview {
  readonly id: string;
  readonly name: string;
  readonly kind: "pdf" | "docx" | "png";
  readonly versions: readonly AgentKernelArtifactVersionPreview[];
}

export const MOCK_ARTIFACT: AgentKernelArtifactPreview = {
  id: "art-q3-summary",
  name: "q3-summary.pdf",
  kind: "pdf",
  versions: [
    { version: 3, label: "v3 · 当前", createdAt: "今天 14:20", producedByRunId: "run-8f21", producedByStepId: "s5", sizeKb: 842, changeNote: "把第二页标题改成「华北下滑归因分析」" },
    { version: 2, label: "v2", createdAt: "今天 11:05", producedByRunId: "run-7a03", producedByStepId: "s5", sizeKb: 810, changeNote: "补充华北区域的红色关注标注" },
    { version: 1, label: "v1 · 初版", createdAt: "昨天 18:42", producedByRunId: "run-6c55", producedByStepId: "s4", sizeKb: 788, changeNote: "首次生成，含 4 张图表" },
  ],
};

// ── 06 错误状态卡片 ────────────────────────────────────────────────
export const MOCK_ERROR = {
  /** 人性化 message，主展示区可见 */
  message: "这次模型没能返回可用的报告内容，任务已停下。你的输入和已生成的中间文件都还在。",
  failureCode: "MODEL_CALL_FAILED",
  /** suggestedAction —— 至少覆盖 重试 / 简化任务重试 / 联系支持 */
  suggestedActions: [
    { kind: "retry" as const, label: "用原任务重试", hint: "不必重新输入，基于原始输入再跑一次" },
    { kind: "simplify" as const, label: "简化后重试", hint: "任务可能过于复杂，拆成更小步骤再试" },
    { kind: "contact" as const, label: "联系支持", hint: "带上本次 run 编号，我们帮你排查" },
  ],
  runId: "run-8f21",
  /** 原始技术细节，折叠区 */
  stack:
`ModelCallError: MODEL_CALL_FAILED (upstream 503 after 3 retries)
    at DeepAgentKernel.invokeModel (kernel/model.py:214)
    at ToolLoop.step (kernel/loop.py:88)
    at Runtime.astream_events (kernel/runtime.py:301)
  request_id=req_9c2f11ab  model=claude-sonnet  latency_ms=61240
  note: 分类器已确认为模型类错误，非 SANDBOX_UNAVAILABLE`,
};
