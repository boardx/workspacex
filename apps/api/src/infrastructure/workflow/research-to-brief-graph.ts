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
}

export class ResearchStageContentError extends Error {
  readonly code = "WORKFLOW_RESEARCH_CONTENT_INCOMPLETE";
  constructor(readonly reason: string) {
    super(`W001 stage content unavailable: ${reason}`);
  }
}

/** Stage bodies only. Runtime owns leases, events, gates, outputs and checkpoints.
 * Publication stays fail closed until its approval and artifact contracts are connected.
 */
export function researchToBriefGraph(deps: ResearchToBriefGraphDeps): LinearWorkflowGraph {
  function work(stageId: string): StageWork {
    return async (exec: StageExecution) => {
      const orgId = exec.lease.orgId;
      const instance = await deps.instances.find(orgId, exec.instanceId);
      if (!instance || instance.orgId !== orgId || instance.workflowKey !== W001.key) {
        throw new ResearchStageContentError("instance_missing_or_wrong_workflow");
      }
      const content = (output: Record<string, unknown>) => ({
        label: `W001/${stageId}`,
        content: { workflowId: W001.id, stageId,
          pinnedSkills: exec.pinnedSkills.filter((pin) => pin.stageId === stageId)
            .map((pin) => `${pin.stableId}@${pin.version}`), output },
      });
      if (stageId === "publish" || stageId === "distribute") {
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
      if (stageId === "review_brief") return content({ approved: true, draft: read("draft").output });
      throw new ResearchStageContentError("unknown_stage");
    };
  }
  return { graphRef: graphRefOf(W001), stages: W001.stages.map((stage) => ({ stageId: stage.stageId, work: work(stage.stageId) })) };
}
