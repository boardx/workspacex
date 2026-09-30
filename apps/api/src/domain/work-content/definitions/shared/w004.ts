/**
 * W004 Weekly Executive Digest（`workflows/W004-weekly-executive-digest.md` §5）。
 *
 * 封闭世界的周度汇总：没有检索阶段；gathering 阶段 2a（S162）与 2b（S007）并行。唯一人工门 H1（周报负责人审阅）；
 * `autoPublishInternal` 满足决策 5 四条件时可由图跳过 H1——这是图工厂按配置的条件，不是门的 `autoApprove`（恒 false，I-C10）。
 * 发布（publish）写 `artifact.write` / `notify.inapp`；`mail.send` 仅在组织授权且收件人全为内部成员时使用（决策 6），
 * 写类阶段的 `sideEffect` 按 `external_send` 封顶处理，因此放进**同一阶段**会把整个发布抬到 external_send。
 * 为让站内发布不依赖邮件授权，本定义把 `mail.send` 独立成 `publish_mail` 阶段（文档 §5 同一行的可选分支），
 * 默认只读授权下两个阶段都落 `blocked_permission`。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

export const W004: WorkContentWorkflowModule = {
  workflowId: "W004",
  key: "weekly-executive-digest",
  version: 1,
  title: "高管周报（Weekly Executive Digest）",
  line: "shared",
  inputSchema: {
    type: "object",
    required: ["digestConfigRef"],
    properties: {
      digestConfigRef: { type: "string" },
      periodEnd: { type: "string", format: "date" },
      supersede: { type: "object", properties: { reason: { type: "string", maxLength: 300 } } },
    },
  },
  stages: [
    stage("intake", "准入（P1：配置冻结 + 项目可读性）", { caps: ["project.read"] }),
    stage("metrics_review", "指标集审视（review-existing）", {
      skills: ["S162"],
      caps: ["docs.read", "metrics.read"],
      parallelGroup: "gathering",
    }),
    stage("status", "多项目周度状态（portfolio-rollup）", {
      skills: ["S007"],
      caps: ["project.read", "board.read", "knowledge.read"],
      parallelGroup: "gathering",
    }),
    stage("review", "目标与承诺对账（executive-weekly）", { skills: ["S155"], caps: ["metrics.read", "warehouse.read"] }),
    stage("sweep", "本周决策扫描（weekly-sweep）", { skills: ["S197"], caps: ["knowledge.graph.read", "docs.read", "transcript.read"] }),
    stage("compose", "面向高管的周报正文（workflow-stage）", { skills: ["S020"] }),
    stage("review_digest", "H1 周报审阅（P4 前）", { sideEffect: "none", gate: { roles: ["digest_owner"], selfApproval: true } }),
    stage("publish", "发布周报（P4 逐收件人核实读权限）", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
    stage("publish_mail", "内部邮件发布（仅内部成员；外部地址一律过滤）", { caps: ["mail.send"], sideEffect: "external_send" }),
  ],
  gates: [gate("H1", "review_digest", { binds: ["digestId", "version"] })],
  constraints: {
    /** 周期下限：schedule 只允许 ≥ 7 天（§4）。 */
    minScheduleCadenceDays: ["7"],
    /** 并发/幂等键：同一 (orgId, digestScopeRef, periodEnd) 至多一份未被取代的已发布周报（T6）。 */
    concurrencyKey: ["orgId", "digestScopeRef", "periodEnd"],
    /** S197 只提议：决策候选只经 notify.inapp 通知，不写知识图谱（决策 7 / T5）。 */
    neverWriteCapabilities: ["knowledge.graph.write"],
  },
};
