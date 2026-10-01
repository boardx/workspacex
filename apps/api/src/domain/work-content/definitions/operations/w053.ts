/**
 * W053 Weekly PMO Review（`workflows/W053-weekly-pmo-review.md` §5）。
 *
 * 2a–2d 并行（`parallelGroup=gathering`）：S143 portfolio-week / S142 hygiene-review / S144 portfolio-load / S145 review-pending；
 * 随后 S010（`reassessOf` = 上周登记表）→ S155（pmo-portfolio）→ assemble（平台内部写）。三道门：
 * H1 复核包审阅（选择要执行的看板整理项、确认 dropped 的上期行动）；H2 看板整理批准（逐条或整批）；
 * H3 变更决定（批准人 = S145 `approversRequired`，多签 ⇒ `requiresDualSign=true`）。
 * 无 webhook 触发；`schedule` 周期 ≥ 7 天；`oralChanges` 只在 manual。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

export const W053: WorkContentWorkflowModule = {
  workflowId: "W053",
  key: "weekly-pmo-review",
  version: 1,
  title: "PMO 周度复核（Weekly PMO Review）",
  line: "operations",
  inputSchema: {
    type: "object",
    required: ["pmoConfigRef"],
    properties: {
      pmoConfigRef: { type: "string" },
      weekEnd: { type: "string", format: "date" },
      priorReviewRef: { type: "string" },
      oralChanges: {
        type: "array",
        maxItems: 10,
        items: { type: "object", properties: { text: { type: "string", maxLength: 2000 }, raisedBy: { type: "string" }, projectId: { type: "string" } } },
      },
      supersede: { type: "object", properties: { reason: { type: "string", maxLength: 300 } } },
    },
  },
  stages: [
    stage("intake", "准入（P1：配置冻结 + 项目可读性 + 上期链）", { caps: ["project.read", "artifact.read"] }),
    stage("status", "逐项目基线偏差（portfolio-week）", { skills: ["S143"], caps: ["board.read"], parallelGroup: "gathering" }),
    stage("hygiene", "看板卫生（hygiene-review）", { skills: ["S142"], caps: ["board.read"], parallelGroup: "gathering" }),
    stage("capacity", "组合装载（portfolio-load）", {
      skills: ["S144"],
      caps: ["board.read", "workforce.schedule.read"],
      parallelGroup: "gathering",
    }),
    stage("changes", "待处理变更复核（review-pending）", { skills: ["S145"], caps: ["artifact.read", "project.read"], parallelGroup: "gathering" }),
    stage("risk", "组合风险周度复评（reassessOf）", { skills: ["S010"] }),
    stage("review", "PMO 组合评审（pmo-portfolio）", { skills: ["S155"], caps: ["artifact.read"] }),
    stage("assemble", "汇成复核包（P6）", { caps: ["artifact.write"], sideEffect: "write" }),
    stage("review_pack", "H1 复核包审阅", { sideEffect: "none", gate: { roles: ["pmo_lead"], selfApproval: true } }),
    stage("apply_board", "H2 执行看板整理项（P3 逐条）", {
      caps: ["board.write"],
      sideEffect: "write",
      gate: { roles: ["pmo_lead", "project_lead"], selfApproval: true },
    }),
    stage("change_decisions", "H3 变更决定与基线更新（多签）", {
      caps: ["artifact.write"],
      sideEffect: "write",
      gate: { roles: ["change_approver", "project_sponsor"] },
    }),
    stage("publish", "发布复核（P4）", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
  ],
  gates: [
    gate("H1", "review_pack", { binds: ["reviewPackDigest"] }),
    gate("H2", "apply_board", { binds: ["changeSetDigest"] }),
    gate("H3", "change_decisions", { dual: true, binds: ["changeRequestIds"] }),
  ],
  constraints: {
    /** 并行收集：四路事实同属 gathering 组。 */
    gatheringStages: ["status", "hygiene", "capacity", "changes"],
    minScheduleCadenceDays: ["7"],
    triggerKinds: ["schedule", "manual"],
  },
};
