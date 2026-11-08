/**
 * CT06 —— UC-WC-3 `getInstanceOutput`（产品线：W029 PRD）。可见性先走 Runtime 的 projection 读
 * （看不到实例 = workflow_not_found），产出只从 persist 阶段输出读，并过契约 schema。
 * 实例未成功结束（还在门上 / 被拒 / 取消）时 `output = null`，不返回半成品；此时 `outcome = "with_holds"`
 * （契约 WorkContentOutcome 只有 complete / with_holds：没有产出就不是 complete）。
 */
import * as workContent from "@repo/contracts/work-content";
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import type { WorkflowStageOutputStore } from "../workflow/workflow-runtime-ports";
import { MaterializationFailedError, type MaterializeDeps } from "../artifact/materialize-artifact";
import { computeContentHash, versionContentHash } from "../../domain/artifact/content-hash";
import { toOrgId } from "../../domain/org-id";

export type ContentInstanceOutput = z.infer<typeof workContent.operations.getInstanceOutput.out>;

export interface GetContentInstanceOutputDeps {
  runtime: { get(orgId: string, userId: string, instanceId: string): Promise<WorkflowInstanceProjection> };
  outputs: WorkflowStageOutputStore;
  files?: MaterializeDeps;
}

const OUTPUT_STAGE = "persist";

export async function getContentInstanceOutput(
  deps: GetContentInstanceOutputDeps,
  orgId: string,
  userId: string,
  instanceId: string,
): Promise<ContentInstanceOutput> {
  const projection = await deps.runtime.get(orgId, userId, instanceId);
  const discovery = projection.workflowKey === "discovery-to-opportunity" && projection.definitionVersion === 2;
  const row = projection.status === "succeeded" ? await deps.outputs.find(orgId, instanceId, discovery ? "publish" : OUTPUT_STAGE, 1) : null;
  const output = row ? workContent.WorkContentOutput.parse(discovery ? row.content.output : row.content.prd) : null;
  let file: z.infer<typeof workContent.SavedPrdFile> | undefined;
  if (output?.kind === "prd" && row?.content.file) {
    const receipt = workContent.PrdFileReceipt.parse(row.content.file);
    if (!deps.files) throw new MaterializationFailedError("W029 file storage not configured");
    const version = await deps.files.repo.findVersion(toOrgId(orgId), receipt.versionId);
    if (!version || version.artifactId !== receipt.artifactId || version.versionNumber !== receipt.versionNumber ||
      version.objectStorageKey !== receipt.materializedKeys[0] || version.contentHash !== receipt.contentHash) {
      throw new MaterializationFailedError("W029 saved version unavailable");
    }
    const parts = await Promise.all(receipt.materializedKeys.map(key => deps.files!.store.get(key)));
    if (parts.some(bytes => !bytes?.byteLength) ||
      versionContentHash(parts.map(bytes => computeContentHash(bytes!))) !== receipt.contentHash) {
      throw new MaterializationFailedError("W029 saved file unreadable or changed");
    }
    const { materializedKeys: _keys, ...reference } = receipt;
    file = workContent.SavedPrdFile.parse({ ...reference, markdown: Buffer.from(parts[0]!).toString("utf8") });
  }
  return workContent.operations.getInstanceOutput.out.parse({
    instanceId,
    outcome: output ? "complete" : "with_holds",
    output,
    ...(file ? { file } : {}),
    crmItems: [],
    manualChecklist: [],
    deferredProposals: [],
  });
}
