/**
 * CT06 —— W029 Problem-to-PRD 的执行图（05-content-lines.md R3 步骤 6；W029 实体文档 §5；契约束 work-content V4）。
 *
 * 节点与 CT05 的 W029 定义逐行一致（同一 `graphRef`，发布校验不变），区别在节点体真正接线：
 * - Skill 阶段（frame S064 / map·solutions_fill S065 / prioritize S068 / draft·revise S067 / kpi S162）
 *   按实例冻结的 pinnedSkills 版本经 `ContentSkillRunnerPort` 执行，输入带此前各 Skill 阶段的产出；
 * - 门阶段（G1–G4）只是回执节点，门本身由 Runtime 的 humanGate 挂起/恢复（WF05）；
 * - persist：从阶段产出装配 `PrdArtifact`（domain），经 effect-gateway（`artifact.write`，重查权限、
 *   receipt 恰好一次）发布；notify：经 effect-gateway `notify.inapp`。
 * 前序产出一律从 stage output 表读（崩溃恢复后仍一致），不靠进程内状态。
 */
import type { ContentSkillRunnerPort } from "../../application/work-content/content-skill-runner";
import type { EffectGateway } from "../../application/workflow/effect-gateway";
import type { StageExecution, StageWork } from "../../application/workflow/run-instance";
import type { WorkflowInstanceRepository } from "../../application/workflow/workflow-ports";
import type { WorkflowStageOutputStore } from "../../application/workflow/workflow-runtime-ports";
import { assemblePrdArtifact, prdStageOutputsFrom } from "../../domain/work-content/prd-artifact";
import { graphRefOf, PRODUCT_LINE_WORKFLOWS } from "../../domain/work-content/product-workflow-definitions";
import type { LinearWorkflowGraph } from "./workflow-graph-registry";

export interface ProblemToPrdGraphDeps {
  skills: ContentSkillRunnerPort;
  outputs: WorkflowStageOutputStore;
  instances: WorkflowInstanceRepository;
  /** 惰性取：effect-gateway 与 Runtime 一同创建，晚于图注册。 */
  effects: () => EffectGateway;
  /** 平台内部 PRD 工件写入（artifact.write 的工具体）；返回工件引用。 */
  publishArtifact(args: { orgId: string; instanceId: string; prd: Record<string, unknown> }): Promise<{ artifactRef: string }>;
  notify(args: { orgId: string; instanceId: string; userId: string; artifactRef: string }): Promise<{ notificationId: string }>;
}

const W029 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W029")!;

async function priorSkillOutputs(deps: ProblemToPrdGraphDeps, exec: StageExecution): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const stage of W029.stages) {
    if (stage.stageId === exec.stageId) break;
    if (stage.skills.length === 0) continue;
    const row = await deps.outputs.find(exec.lease.orgId, exec.instanceId, stage.stageId, 1);
    if (row) out[stage.stageId] = row.content.output;
  }
  return out;
}

function skillWork(deps: ProblemToPrdGraphDeps, stageId: string): StageWork {
  return async (exec) => {
    const prior = await priorSkillOutputs(deps, exec);
    const pins = exec.pinnedSkills.filter((p) => p.stageId === stageId);
    let output: Record<string, unknown> = {};
    for (const pin of pins) {
      output = await deps.skills.run({
        orgId: exec.lease.orgId,
        instanceId: exec.instanceId,
        workflowId: "W029",
        stageId,
        skillId: pin.stableId,
        skillVersion: pin.version,
        input: exec.input,
        prior,
      });
    }
    return { label: `W029/${stageId}`, content: { workflowId: "W029", stageId, pinnedSkills: pins.map((p) => `${p.stableId}@${p.version}`), output } };
  };
}

function plainWork(stageId: string): StageWork {
  return async () => ({ label: `W029/${stageId}`, content: { workflowId: "W029", stageId } });
}

function effectWork(deps: ProblemToPrdGraphDeps, stageId: "persist" | "notify"): StageWork {
  return async (exec) => {
    const orgId = exec.lease.orgId;
    const instance = await deps.instances.find(orgId, exec.instanceId);
    if (!instance) throw new Error(`instance ${exec.instanceId} not found`);
    const base = {
      orgId,
      instanceId: exec.instanceId,
      stageId,
      workflowKey: W029.key,
      sideEffect: "write" as const,
      initiatorUserId: instance.initiatorUserId,
      agentId: instance.agentId,
      agentVersionId: instance.agentVersionId,
      approvalRequestId: exec.approval?.gateId ?? null,
    };
    if (stageId === "persist") {
      const prd = assemblePrdArtifact(prdStageOutputsFrom(await priorSkillOutputs(deps, exec)));
      const out = await deps.effects().execute(
        exec.lease,
        { ...base, effectKey: `prd-${prd.digest}`, capabilityCategory: "artifact.write", fingerprint: prd.digest, args: { prd } },
        async (args) => deps.publishArtifact({ orgId, instanceId: exec.instanceId, prd: args.prd as Record<string, unknown> }),
      );
      return { label: "W029/persist", content: { workflowId: "W029", stageId, prd, artifactRef: out.result.artifactRef } };
    }
    const persisted = await deps.outputs.find(orgId, exec.instanceId, "persist", 1);
    const artifactRef = String(persisted?.content.artifactRef ?? "");
    const out = await deps.effects().execute(
      exec.lease,
      { ...base, effectKey: `notify-${artifactRef}`, capabilityCategory: "notify.inapp", fingerprint: artifactRef, args: { artifactRef } },
      async () => deps.notify({ orgId, instanceId: exec.instanceId, userId: instance.initiatorUserId, artifactRef }),
    );
    return { label: "W029/notify", content: { workflowId: "W029", stageId, notificationId: out.result.notificationId } };
  };
}

export function problemToPrdGraph(deps: ProblemToPrdGraphDeps): LinearWorkflowGraph {
  return {
    graphRef: graphRefOf(W029),
    stages: W029.stages.map((s) => ({
      stageId: s.stageId,
      work:
        s.stageId === "persist" || s.stageId === "notify"
          ? effectWork(deps, s.stageId)
          : s.skills.length > 0
            ? skillWork(deps, s.stageId)
            : plainWork(s.stageId),
    })),
  };
}
