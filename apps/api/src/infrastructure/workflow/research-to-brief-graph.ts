import { createHash } from "node:crypto";
import type { EffectGateway } from "../../application/workflow/effect-gateway";
import type { ResearchBriefPublication } from "../../application/work-content/research-brief-publication";
import type { ContentSkillRunnerPort } from "../../application/work-content/content-skill-runner";
import { researchClaims, researchMaterials } from "../../application/work-content/research-stage-content";
import type { StageExecution, StageWork } from "../../application/workflow/run-instance";
import type { WorkflowInstanceRepository } from "../../application/workflow/workflow-ports";
import type { WorkflowStageOutputStore } from "../../application/workflow/workflow-runtime-ports";
import { W001 } from "../../domain/work-content/definitions/W001";
import { auditClaims, buildDataNeedsStatement, buildResearchBrief } from "../../domain/work-content/research-brief";
import { graphRefOf } from "../../domain/work-content/workflow-definition";
import type { LinearWorkflowGraph } from "./workflow-graph-registry";

export interface ResearchToBriefGraphDeps {
  skills: ContentSkillRunnerPort;
  outputs: WorkflowStageOutputStore;
  instances: WorkflowInstanceRepository;
  effects?: () => EffectGateway;
  publishArtifact?: (args: ResearchBriefPublication) => Promise<Record<string, unknown>>;
}

export class ResearchStageContentError extends Error {
  readonly code = "WORKFLOW_RESEARCH_CONTENT_INCOMPLETE";
  constructor(readonly reason: string) {
    super(`W001 stage content unavailable: ${reason}`);
  }
}

/** Stage bodies only. Runtime owns leases, events, gates, outputs and checkpoints.
 * V1 publication stays closed; v2 uses independent review and native materialization. Distribution remains closed.
 */
export function researchToBriefGraph(deps: ResearchToBriefGraphDeps, version = 1): LinearWorkflowGraph {
  function work(stageId: string): StageWork {
    return async (exec: StageExecution) => {
      const orgId = exec.lease.orgId;
      const instance = await deps.instances.find(orgId, exec.instanceId);
      if (!instance || instance.orgId !== orgId || instance.workflowKey !== W001.key || instance.definitionVersion !== version) {
        throw new ResearchStageContentError("instance_missing_or_wrong_workflow");
      }
      const content = (output: Record<string, unknown>) => ({
        label: `W001/${stageId}`,
        content: { workflowId: W001.id, stageId,
          pinnedSkills: exec.pinnedSkills.filter((pin) => pin.stageId === stageId)
            .map((pin) => `${pin.stableId}@${pin.version}`), output },
      });
      if (stageId === "distribute" || stageId === "publish" && (!deps.effects || !deps.publishArtifact)) {
        throw new ResearchStageContentError("publication_contract_not_connected");
      }
      const question = typeof exec.input.question === "string" ? exec.input.question.trim() : "";
      if (!question) throw new ResearchStageContentError("question_missing");
      if (stageId === "scope") {
        return content({ question, recipientCategories: exec.input.recipientCategories ?? [] });
      }
      const prior: Record<string, unknown> = {};
      for (const stage of W001.stages) {
        if (stage.stageId === stageId) break;
        // Runtime retries each stage independently; prior outputs use their committed attempt.
        // W001 currently freezes maxAttempts=1, so do not assume exec.attempt for predecessors.
        const row = await deps.outputs.find(orgId, exec.instanceId, stage.stageId, 1);
        if (!row) throw new ResearchStageContentError(`prior_output_missing:${stage.stageId}`);
        prior[stage.stageId] = row.content.output;
      }
      const read = (id: string) => {
        const value = prior[id];
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new ResearchStageContentError(`prior_output_invalid:${id}`);
        }
        return value as Record<string, unknown>;
      };
      if (stageId === "publish") {
        const approval = read("review_brief").approval as { gateId?: unknown; decidedBy?: unknown } | undefined;
        if (!approval || typeof approval.gateId !== "string" || !approval.gateId ||
          typeof approval.decidedBy !== "string" || !approval.decidedBy || approval.decidedBy === instance.initiatorUserId) {
          throw new ResearchStageContentError("independent_review_approval_missing");
        }
        const draft = read("draft").output as { kind?: string; title?: unknown; claims?: unknown; risks?: unknown; digest?: unknown } | undefined;
        if (draft?.kind !== "research_brief" || typeof draft.title !== "string") {
          throw new ResearchStageContentError("evidenced_brief_missing");
        }
        const sourceMaterials = researchMaterials(read("search").materials);
        const claims = researchClaims(draft.claims); const risks = researchClaims(draft.risks);
        if (!claims.length || auditClaims(claims, sourceMaterials).length !== claims.length ||
          auditClaims(risks, sourceMaterials).length !== risks.length || read("citation_check").allEvidenced !== true) {
          throw new ResearchStageContentError("citations_invalid");
        }
        const brief = buildResearchBrief(draft.title, claims, risks);
        if (brief.digest !== draft.digest || JSON.stringify(read("review_brief").draft) !== JSON.stringify(draft)) {
          throw new ResearchStageContentError("reviewed_brief_changed");
        }
        const provenance = { workflowId: W001.id, workflowKey: instance.workflowKey, instanceId: exec.instanceId,
          agentId: instance.agentId, agentVersionId: instance.agentVersionId,
          initiatorUserId: instance.initiatorUserId, approval,
          pinnedSkills: instance.pinnedSkills,
          sourceRefs: sourceMaterials.map(m => ({ ref: m.ref, contentSha256: createHash("sha256").update(m.text).digest("hex") })),
          semanticSupportVerified: false };
        const fingerprint = createHash("sha256").update(JSON.stringify({ brief, provenance })).digest("hex");
        const effect = await deps.effects!().execute(exec.lease, {
          orgId, instanceId: exec.instanceId, stageId, workflowKey: instance.workflowKey,
          initiatorUserId: instance.initiatorUserId, agentId: instance.agentId, agentVersionId: instance.agentVersionId,
          approvalRequestId: approval.gateId, sideEffect: "write", capabilityCategory: "artifact.write",
          effectKey: `brief-${brief.digest}`, fingerprint, args: { brief, provenance },
        }, async () => deps.publishArtifact!({ orgId, initiatorUserId: instance.initiatorUserId, brief, provenance }));
        return content({ brief, artifact: effect.result, effectProvenance: effect.provenance });
      }
      const materials = stageId === "search" ? [] : researchMaterials(read("search").materials);
      const noEvidence = () => buildDataNeedsStatement(question, [`可支撑结论的证据：${question}`]);
      const pins = exec.pinnedSkills.filter((pin) => pin.stageId === stageId);
      const expected = W001.stages.find((stage) => stage.stageId === stageId)!.skills;
      if (pins.length !== expected.length || expected.some((id) => !pins.some((pin) => pin.stableId === id))) {
        throw new ResearchStageContentError("pinned_skill_missing_or_duplicated");
      }
      let output: Record<string, unknown> = {};
      if (expected.length) {
        if (stageId !== "search" && (materials.length === 0 ||
          (stageId === "risk" || stageId === "draft") && researchClaims(read("audit").claims).length === 0)) {
          // Keep a durable data-needs body; no model-generated conclusion or publication.
          return content({ output: noEvidence(), claims: [], risks: [] });
        }
        for (const pin of pins) {
          output = await deps.skills.run({ orgId, instanceId: exec.instanceId,
            agentVersionId: instance.agentVersionId, workflowId: W001.id, stageId,
            skillId: pin.stableId, skillVersion: pin.version, input: exec.input, prior });
        }
      }
      if (stageId === "search") return content({ materials: researchMaterials(output.materials) });
      if (stageId === "synthesize") return content({ claims: researchClaims(output.claims) });
      if (stageId === "audit") return content({ claims: auditClaims(researchClaims(output.claims), materials) });
      if (stageId === "risk") return content({ risks: auditClaims(researchClaims(output.risks), materials) });
      if (stageId === "draft") {
        const claims = auditClaims(researchClaims(read("audit").claims), materials);
        const risks = auditClaims(researchClaims(read("risk").risks), materials);
        const title = typeof output.title === "string" && output.title.trim() ? output.title : question;
        return content({ output: claims.length ? buildResearchBrief(title, claims, risks) : noEvidence() });
      }
      if (stageId === "citation_check") {
        const draft = read("draft").output as { kind?: string; claims?: unknown; risks?: unknown } | undefined;
        if (draft?.kind === "data_needs_statement") {
          throw new ResearchStageContentError("evidence_missing_no_publication");
        }
        const claims = researchClaims(draft?.claims);
        const risks = researchClaims(draft?.risks);
        if (!claims.length || auditClaims(claims, materials).length !== claims.length ||
          auditClaims(risks, materials).length !== risks.length) {
          throw new ResearchStageContentError("citations_invalid");
        }
        return content({ claimCount: claims.length, allEvidenced: true });
      }
      if (stageId === "review_brief") {
        if (version === 1) return content({ approved: true, draft: read("draft").output });
        if (!exec.approval?.decidedBy || exec.approval.decidedBy === instance.initiatorUserId) {
          throw new ResearchStageContentError("independent_review_approval_missing");
        }
        return content({ approved: true, approval: exec.approval, draft: read("draft").output });
      }
      throw new ResearchStageContentError("unknown_stage");
    };
  }
  return { graphRef: graphRefOf({ ...W001, version }), stages: W001.stages.map((stage) => ({ stageId: stage.stageId, work: work(stage.stageId) })) };
}
