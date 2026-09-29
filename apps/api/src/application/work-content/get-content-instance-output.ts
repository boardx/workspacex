/**
 * CT06 —— UC-WC-3 `getInstanceOutput`（产品线：W029 PRD）。可见性先走 Runtime 的 projection 读
 * （看不到实例 = workflow_not_found），产出只从 persist 阶段输出读，并过契约 schema。
 * 实例未成功结束（还在门上 / 被拒）时 `output = null`，不返回半成品。
 */
import * as workContent from "@repo/contracts/work-content";
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import type { WorkflowStageOutputStore } from "../workflow/workflow-runtime-ports";

export type ContentInstanceOutput = z.infer<typeof workContent.operations.getInstanceOutput.out>;

export interface GetContentInstanceOutputDeps {
  runtime: { get(orgId: string, userId: string, instanceId: string): Promise<WorkflowInstanceProjection> };
  outputs: WorkflowStageOutputStore;
}

const OUTPUT_STAGE = "persist";

export async function getContentInstanceOutput(
  deps: GetContentInstanceOutputDeps,
  orgId: string,
  userId: string,
  instanceId: string,
): Promise<ContentInstanceOutput> {
  const projection = await deps.runtime.get(orgId, userId, instanceId);
  const row = projection.status === "succeeded" ? await deps.outputs.find(orgId, instanceId, OUTPUT_STAGE, 1) : null;
  const output = row ? workContent.WorkContentOutput.parse(row.content.prd) : null;
  return workContent.operations.getInstanceOutput.out.parse({
    instanceId,
    outcome: "complete",
    output,
    crmItems: [],
    manualChecklist: [],
    deferredProposals: [],
  });
}
