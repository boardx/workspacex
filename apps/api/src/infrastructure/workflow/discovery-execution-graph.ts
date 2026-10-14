import { createHash } from "node:crypto";
import { DiscoveryFieldworkResult, DiscoveryOutlineResult, DiscoveryPublicationResult } from "@repo/contracts/discovery-execution";
import type { EffectGateway } from "../../application/workflow/effect-gateway";
import type { StageExecution, StageWork } from "../../application/workflow/run-instance";
import { prepareDiscoveryOutline, type DiscoveryOutlineImport } from "../../application/work-content/discovery-outline-import";
import { discoveryExecutionDefinition } from "../../domain/work-content/discovery-execution-definition";
import { freezeDiscoveryPlan, validateDiscoveryStage } from "../../domain/work-content/discovery-stage-validation";
import type { LinearWorkflowGraph } from "./workflow-graph-registry";
import { ContentStageUnavailableError, contentStageContext, pinnedContentStage,
  type PinnedContentStageDeps } from "./pinned-content-stage";

export interface DiscoveryExecutionDeps extends PinnedContentStageDeps {
  effects: () => EffectGateway;
  /** Platform adapters must produce actual results. No adapter is synthesized from metadata. */
  adapters?: Partial<Record<"import_outline" | "fieldwork" | "publish", (args: {
    orgId: string; instanceId: string; initiatorUserId: string;
    input: Record<string, unknown>; prior: Readonly<Record<string, unknown>>;
    outline?: DiscoveryOutlineImport;
  }) => Promise<Record<string, unknown>>>>;
}

const definition = discoveryExecutionDefinition();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function discoveryExecutionGraph(deps?: DiscoveryExecutionDeps): LinearWorkflowGraph {
  const unavailable: StageWork = async () => { throw new ContentStageUnavailableError("W027_execution_not_configured"); };
  const work: StageWork = async (exec: StageExecution) => {
    if (!deps) return unavailable(exec);
    const context = await contentStageContext(deps, definition, exec);
    const { stage, prior, instance } = context;
    if (stage.skills.length) {
      const result = await pinnedContentStage(deps, "W027", definition,
        stage.stageId === "hypothesize" ? "Omit criteriaDigest. The server computes and freezes it from your validated tests before human review." : undefined)(exec);
      if (stage.stageId === "hypothesize") result.content.output = freezeDiscoveryPlan(result.content.output as Record<string, unknown>);
      validateDiscoveryStage(stage.stageId, result.content.output, prior);
      return result;
    }
    if (stage.stageId.startsWith("review_")) {
      const reviewedStageId = stage.stageId.slice("review_".length);
      const reviewed = prior[reviewedStageId];
      if (!reviewed || !exec.approval?.decidedBy) {
        throw new ContentStageUnavailableError("reviewed_output_or_approval_missing");
      }
      return { label: `W027/${stage.stageId}`, content: { workflowId: "W027", stageId: stage.stageId,
        output: { reviewedStageId, payloadDigest: digest(reviewed), approval: exec.approval } } };
    }
    const adapter = deps.adapters?.[stage.stageId as keyof NonNullable<DiscoveryExecutionDeps["adapters"]>];
    if (!adapter) throw new ContentStageUnavailableError(`stage_adapter_missing:${stage.stageId}`);
    const args = { orgId: exec.lease.orgId, instanceId: exec.instanceId,
      initiatorUserId: instance.initiatorUserId, input: exec.input, prior,
      ...(stage.stageId === "import_outline" ? { outline: prepareDiscoveryOutline(exec.instanceId, 1,
        prior.plan_interviews, (exec.input.fieldwork as { plannedMinutes?: number } | undefined)?.plannedMinutes ?? 0) } : {}) };
    const runAdapter = async () => {
      const result = await adapter(args);
      const schema = stage.stageId === "import_outline" ? DiscoveryOutlineResult
        : stage.stageId === "fieldwork" ? DiscoveryFieldworkResult : DiscoveryPublicationResult;
      if (!schema.safeParse(result).success) throw new ContentStageUnavailableError(`adapter_result_invalid:${stage.stageId}`);
      return result;
    };
    if (stage.sideEffect === "none") {
      if (!exec.approval?.decidedBy) throw new ContentStageUnavailableError("fieldwork_declaration_missing");
      const result = await runAdapter();
      if (result.declaredBy !== exec.approval.decidedBy) throw new ContentStageUnavailableError("fieldwork_declarer_not_approver");
      return { label: `W027/${stage.stageId}`, content: { workflowId: "W027", stageId: stage.stageId,
        output: result } };
    }
    // All internal writes use the runtime's permission recheck and replay receipts.
    const reviewedStageId = stage.stageId === "import_outline" ? "plan_interviews" : "map";
    const review = prior[`review_${reviewedStageId}`] as {
      payloadDigest?: string; approval?: { gateId?: string; decidedBy?: string };
    } | undefined;
    if (!review?.approval?.gateId || !review.approval.decidedBy ||
      review.payloadDigest !== digest(prior[reviewedStageId])) {
      throw new ContentStageUnavailableError("approved_payload_changed_or_missing");
    }
    const fingerprint = digest(args);
    const effect = await deps.effects().execute(exec.lease, {
      orgId: exec.lease.orgId, instanceId: exec.instanceId, stageId: stage.stageId,
      workflowKey: definition.key, initiatorUserId: instance.initiatorUserId,
      agentId: instance.agentId, agentVersionId: instance.agentVersionId,
      approvalRequestId: review.approval.gateId, sideEffect: "write",
      capabilityCategory: stage.capabilityCategories[0]!,
      effectKey: `discovery-${stage.stageId}`, fingerprint, args,
    }, runAdapter);
    return { label: `W027/${stage.stageId}`, content: { workflowId: "W027", stageId: stage.stageId,
      output: effect.result, effectProvenance: effect.provenance } };
  };
  return { graphRef: definition.graphRef, stages: definition.stages.map(stage => ({
    stageId: stage.stageId, work: deps ? work : unavailable,
    ...(stage.stageId.startsWith("review_") && deps ? { gatePreview: async exec => {
      const { prior } = await contentStageContext(deps, definition, { ...exec, approval: null });
      const reviewedStageId = stage.stageId.slice("review_".length);
      return { capabilityCategory: "workflow.gate", targetSystem: "workflow",
        summary: `Review W027 ${reviewedStageId} committed output`,
        payloadPreview: { reviewedStageId, output: prior[reviewedStageId], payloadDigest: digest(prior[reviewedStageId]) } };
    } } : {}),
  })) };
}
