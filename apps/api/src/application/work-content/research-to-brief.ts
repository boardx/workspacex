/**
 * Phase 20 CT03 —— 研究线端到端：W001 Research-to-Brief（05 号 R3 步骤 3–4；R4 A4；契约束 work-content V3）。
 *
 * 按 W001 代码定义的阶段表依次推进；Skill 阶段只用 Workflow 固定的 semanticVersion 调用（ADR-118 #9 / I-C5），
 * 与 Agent 挂载无关。人工门：G2 简报审阅 → G3 分发（外部收件人类别双签）。发布是唯一外部效果，
 * 经 effect-gateway（执行前重查权限，receipt 保证至多一次）。
 *
 * A4：检索无材料或评审后无站得住的结论 → 产出数据需求说明，实例 `succeeded` + outcome `with_holds`
 * （I-C9：不新增实例状态），不开门、不发布。
 */
import type { WorkflowInstanceStatus, WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import type { WorkContentOutcome } from "@repo/contracts/work-content";
import {
  auditClaims,
  buildDataNeedsStatement,
  buildResearchBrief,
  distributionSignoffSatisfied,
  requiresDualSign,
  type DataNeedsOutput,
  type DraftClaim,
  type ResearchBriefOutput,
  type ResearchMaterial,
} from "../../domain/work-content/research-brief";
import { W001 } from "../../domain/work-content/definitions/W001";
import type { EffectGateway } from "../workflow/effect-gateway";
import type { WorkflowLease } from "../workflow/workflow-ports";
import type { WorkflowEventInput, WorkflowEventStore, WorkflowStageOutputStore } from "../workflow/workflow-runtime-ports";

/** 按固定版本调用一个 Skill（回环模型 / 桩工具 / 真实执行器都实现这个端口）。 */
export interface PinnedSkillExecutorPort {
  run(call: { skillId: string; semanticVersion: string; input: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

export interface GateDecision {
  decision: "approved" | "denied";
  approverUserIds: string[];
  requestId: string;
}

/** 人工门决定来源（审阅人的 approve/deny；测试里是确定性桩）。 */
export interface ResearchGateDecisionPort {
  decide(gate: { instanceId: string; gateId: string; stageId: string; requiresDualSign: boolean; payload: Record<string, unknown> }): Promise<GateDecision>;
}

/** 真正把简报发布出去的工具（只在 effect-gateway 放行且非重放时调用）。 */
export interface BriefPublisherPort {
  publish(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ResearchToBriefDeps {
  skills: PinnedSkillExecutorPort;
  gates: ResearchGateDecisionPort;
  publisher: BriefPublisherPort;
  effects: EffectGateway;
  events: WorkflowEventStore;
  outputs: WorkflowStageOutputStore;
  newId(): string;
}

export interface ResearchToBriefCommand {
  orgId: string;
  instanceId: string;
  initiatorUserId: string;
  agentId: string;
  agentVersionId: string;
  question: string;
  recipientCategories: string[];
}

export interface ResearchToBriefResult {
  status: WorkflowInstanceStatus;
  outcome: z.infer<typeof WorkContentOutcome> | null;
  output: ResearchBriefOutput | DataNeedsOutput | null;
  skillCalls: { skillId: string; semanticVersion: string }[];
  published: boolean;
}

export const PUBLISH_CAPABILITY = "artifact.write";

class Halt extends Error {
  constructor(readonly status: WorkflowInstanceStatus) {
    super(`research-to-brief halted: ${status}`);
  }
}

function asMaterials(v: unknown): ResearchMaterial[] {
  if (!Array.isArray(v)) return [];
  return v.filter((m): m is ResearchMaterial => typeof m?.ref === "string" && typeof m?.text === "string");
}

function asClaims(v: unknown): DraftClaim[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c) => typeof c?.text === "string" && Array.isArray(c?.evidenceRefs))
    .map((c) => ({
      text: c.text as string,
      evidenceRefs: (c.evidenceRefs as unknown[]).filter((r): r is string => typeof r === "string"),
      confidence: c.confidence === "high" || c.confidence === "low" ? c.confidence : "medium",
    }));
}

export async function runResearchToBrief(
  deps: ResearchToBriefDeps,
  lease: WorkflowLease,
  cmd: ResearchToBriefCommand,
): Promise<ResearchToBriefResult> {
  const { orgId, instanceId } = cmd;
  const skillCalls: ResearchToBriefResult["skillCalls"] = [];
  let published = false;

  const append = async (event: WorkflowEventInput, opts?: { status?: WorkflowInstanceStatus; reasonCode?: WorkflowReasonCode | null }) => {
    const r = await deps.events.append(orgId, instanceId, event, opts);
    if (!r.ok) throw new Halt("cancelled");
  };
  const stageOutput = async (stageId: string, label: string, content: Record<string, unknown>) => {
    await append({ type: "stage_started", stageId, reasonCode: null, data: { attempt: 1 } });
    const { row } = await deps.outputs.put(orgId, instanceId, { stageId, attempt: 1, outputId: deps.newId(), label, content });
    await append({ type: "stage_output_written", stageId, reasonCode: null, data: { attempt: 1, outputId: row.outputId, label } });
    await append({ type: "stage_succeeded", stageId, reasonCode: null, data: { attempt: 1, outputId: row.outputId } });
  };
  const skill = async (skillId: string, input: Record<string, unknown>) => {
    const semanticVersion = W001.skillVersions[skillId];
    if (!semanticVersion) throw new Error(`W001 has no pinned version for ${skillId}`);
    skillCalls.push({ skillId, semanticVersion });
    return deps.skills.run({ skillId, semanticVersion, input });
  };
  const gate = async (gateId: string, payload: Record<string, unknown>) => {
    const def = W001.gates.find((g) => g.gateId === gateId)!;
    const dual = gateId === "G3" ? requiresDualSign(cmd.recipientCategories) : false;
    await append({ type: "gate_opened", stageId: def.stageId, reasonCode: null, data: { gateId, requiresDualSign: dual } }, { status: "awaiting_gate_decision" });
    const d = await deps.gates.decide({ instanceId, gateId, stageId: def.stageId, requiresDualSign: dual, payload });
    if (d.decision === "denied") {
      await append({ type: "gate_decided", stageId: def.stageId, reasonCode: "gate_denied", data: { gateId, decision: "denied" } }, { status: "rejected", reasonCode: "gate_denied" });
      throw new Halt("rejected");
    }
    const satisfied = gateId === "G3"
      ? distributionSignoffSatisfied(cmd.recipientCategories, d.approverUserIds, cmd.initiatorUserId)
      : d.approverUserIds.some((u) => u !== cmd.initiatorUserId);
    if (!satisfied) throw new Halt("awaiting_gate_decision"); // 签核不足：门保持打开，不前进、不发布
    await append({ type: "gate_decided", stageId: def.stageId, reasonCode: null, data: { gateId, decision: "approved", approvers: d.approverUserIds } }, { status: "running" });
    return d;
  };
  const finish = async (outcome: z.infer<typeof WorkContentOutcome>) =>
    append({ type: "status_changed", stageId: null, reasonCode: null, data: { status: "succeeded", outcome } }, { status: "succeeded", reasonCode: null });

  let output: ResearchBriefOutput | DataNeedsOutput | null = null;
  try {
    await stageOutput("scope", "范围与用途", { question: cmd.question, recipientCategories: cmd.recipientCategories });

    const search = await skill("S003", { question: cmd.question });
    const materials = asMaterials(search.materials);
    await stageOutput("search", "检索证据", { materials });

    let claims: DraftClaim[] = [];
    if (materials.length > 0) {
      claims = asClaims((await skill("S063", { question: cmd.question, materials })).claims);
      await stageOutput("synthesize", "研究综合", { claims });
      claims = auditClaims(asClaims((await skill("S171", { claims, materials })).claims), materials);
      await stageOutput("audit", "证据评审", { claims });
    }

    if (claims.length === 0) {
      // A4：不编造结论 → 数据需求说明，completed_with_holds。
      const missing = materials.length === 0 ? [`可检索材料：${cmd.question}`] : [`可支撑结论的证据：${cmd.question}`];
      output = buildDataNeedsStatement(cmd.question, missing);
      await stageOutput("draft", "数据需求说明", { output });
      await finish("with_holds");
      return { status: "succeeded", outcome: "with_holds", output, skillCalls, published };
    }

    const draft = await skill("S020", { question: cmd.question, claims });
    const title = typeof draft.title === "string" && draft.title.trim() ? draft.title : cmd.question;
    const risks = auditClaims(asClaims((await skill("S010", { claims, materials })).risks), materials);
    await stageOutput("risk", "风险评估", { risks });
    output = buildResearchBrief(title, claims, risks);
    await stageOutput("draft", "起草简报", { output });
    await stageOutput("citation_check", "引用校验", { claimCount: output.claims.length, allEvidenced: true });

    await gate("G2", { brief: output });
    await stageOutput("review_brief", "简报审阅", { approved: true });
    const g3 = await gate("G3", { recipientCategories: cmd.recipientCategories, digest: output.digest });

    const brief = output;
    const effect = await deps.effects.execute(
      lease,
      {
        orgId,
        instanceId,
        stageId: "publish",
        workflowKey: W001.key,
        effectKey: `publish-${brief.digest.slice(0, 16)}`,
        capabilityCategory: PUBLISH_CAPABILITY,
        sideEffect: "write",
        initiatorUserId: cmd.initiatorUserId,
        agentId: cmd.agentId,
        agentVersionId: cmd.agentVersionId,
        fingerprint: brief.digest,
        args: { brief, recipientCategories: cmd.recipientCategories },
        approvalRequestId: g3.requestId,
      },
      (args) => deps.publisher.publish(args),
    );
    published = effect.kind === "executed" || effect.kind === "replayed";
    await stageOutput("publish", "发布", { digest: brief.digest, result: effect.result });
    await stageOutput("distribute", "分发", { recipientCategories: cmd.recipientCategories });
    await finish("complete");
    return { status: "succeeded", outcome: "complete", output, skillCalls, published };
  } catch (e) {
    if (e instanceof Halt) return { status: e.status, outcome: null, output, skillCalls, published };
    throw e;
  }
}
