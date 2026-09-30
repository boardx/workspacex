/**
 * W052 Request-to-Project（`workflows/W052-request-to-project.md` §5）。
 *
 * 两道门：H1 受理（S141 之后、S154 之前；审批人按组织 `approvalRoute`，缺失时由发起人指定具名角色并由服务端核验）；
 * H2 基线批准（整包：章程 + 计划 + 容量 + 风险 + 卡预览）。规划（S154/S142/S144/S010）只对 H1 已受理的请求运行。
 * 6a/6b/6c 并行（`parallelGroup=planning`）。S144 `does-not-fit` 时 H2 无「按原计划批准」选项、
 * `approve_with_tradeoff` 需受影响资源负责人共同签——多签在单门中的表达文档 §16 标 UNVERIFIED，此处按
 * 「H2 审批角色含 resource_owner」建模，共同签字由图工厂在门内校验（缺口，见注册测试说明）。
 * 请求人与 sponsor 不能是唯一审批人：两门 `allowSelfApproval=false`。
 * 写类阶段：clarify / create_project / write_cards / register_baseline / notify；默认只读授权下全部 blocked_permission。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

export const W052: WorkContentWorkflowModule = {
  workflowId: "W052",
  key: "request-to-project",
  version: 1,
  title: "请求到项目（Request-to-Project）",
  line: "operations",
  inputSchema: {
    type: "object",
    required: ["requestKey", "request"],
    properties: {
      requestKey: { type: "string" },
      request: { type: "object" },
      target: { type: "object", properties: { kind: { type: "string", enum: ["new-project", "existing-project"] }, projectId: { type: "string" } } },
      approvalRouteRef: { type: "string" },
    },
  },
  stages: [
    stage("intake", "准入（P1：requestKey 幂等 + 发起人/请求人核验）", { caps: ["project.read"] }),
    stage("charter", "请求归类与项目章程（intake-charter）", { skills: ["S141"], caps: ["project.read", "directory.read", "knowledge.search"] }),
    stage("clarify", "向请求人澄清（≤ 2 轮 / 14 天）", { caps: ["notify.inapp"], sideEffect: "write" }),
    stage("accept", "H1 受理规划", { sideEffect: "none", gate: { roles: ["project_sponsor", "pmo_lead"] } }),
    stage("plan", "项目计划（project-to-plan）", { skills: ["S154"], caps: ["board.read"] }),
    stage("preview", "建卡预览与去重（materialize）", { skills: ["S142"], caps: ["board.read"], parallelGroup: "planning" }),
    stage("capacity", "容量核对（fit-check）", {
      skills: ["S144"],
      caps: ["board.read", "workforce.schedule.read"],
      parallelGroup: "planning",
    }),
    stage("risk", "执行风险评估（对计划）", { skills: ["S010"], parallelGroup: "planning" }),
    stage("approve_baseline", "H2 基线批准（整包）", {
      sideEffect: "none",
      gate: { roles: ["pmo_lead", "project_sponsor", "resource_owner"] },
    }),
    stage("create_project", "创建项目并添加成员（P3）", { caps: ["project.write", "project.member.write"], sideEffect: "write" }),
    stage("write_cards", "写入看板卡片（P3 逐卡 receipt）", { caps: ["board.write"], sideEffect: "write" }),
    stage("register_baseline", "登记基线产物", { caps: ["artifact.write"], sideEffect: "write" }),
    stage("notify", "通知（项目启动）", { caps: ["notify.inapp"], sideEffect: "write" }),
  ],
  gates: [
    gate("H1", "accept", { binds: ["charterId"] }),
    gate("H2", "approve_baseline", { binds: ["planVersion", "capacityConclusion", "riskRegisterId", "changeSetDigest"] }),
  ],
  constraints: {
    /** 规划只对 H1 已受理的请求运行：这些阶段必须排在 accept 之后。 */
    planningAfterAcceptStages: ["plan", "preview", "capacity", "risk"],
    /** H2 在 S144 `does-not-fit` 时没有「按原计划批准」选项（决策 4）。 */
    h2NoPlainApproveWhen: ["does-not-fit"],
  },
};
