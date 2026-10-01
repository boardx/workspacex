/**
 * phase-18 S10（issue #4367）——「分享到项目…」的前端取数口。三个接口都对着契约 `knowledgeGraph`：
 *   · `listProjectShareTargets` GET  /knowledge-graph/personal/claims/:claimId/share-targets —— 选项目 + 范围预览
 *   · `shareToProject`          POST /knowledge-graph/personal/claims/:claimId/share         —— 确认分享（幂等）
 *   · `unshareFromProject`      POST /knowledge-graph/personal/claims/:claimId/unshare       —— 撤回
 * 返回值经契约 `out` 校验；失败抛 `KnowledgeGraphError`（同 knowledge-graph-api.ts）。
 */
import type { z } from "zod";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { getParsed, knowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";
import { describeHumanActionFailure } from "@/lib/knowledge-graph-failure";

export type ProjectShareTargets = z.infer<typeof knowledgeGraph.listProjectShareTargets.out>;
export type ShareToProjectResult = z.infer<typeof knowledgeGraph.shareToProject.out>;

const seg = (v: string): string => encodeURIComponent(v);

export function fetchProjectShareTargets(claimId: string, signal?: AbortSignal): Promise<ProjectShareTargets> {
  return getParsed(`/knowledge-graph/personal/claims/${seg(claimId)}/share-targets`, knowledgeGraph.listProjectShareTargets.out, signal);
}

export function shareClaimToProject(claimId: string, projectId: string): Promise<ShareToProjectResult> {
  const input = knowledgeGraph.shareToProject.in.parse({ claimId, projectId });
  return getParsed(`/knowledge-graph/personal/claims/${seg(input.claimId)}/share`, knowledgeGraph.shareToProject.out, undefined,
    { method: "POST", body: { projectId: input.projectId } });
}

export function unshareClaimFromProject(claimId: string, projectId: string): Promise<z.infer<typeof knowledgeGraph.unshareFromProject.out>> {
  const input = knowledgeGraph.unshareFromProject.in.parse({ claimId, projectId });
  return getParsed(`/knowledge-graph/personal/claims/${seg(input.claimId)}/unshare`, knowledgeGraph.unshareFromProject.out, undefined,
    { method: "POST", body: { projectId: input.projectId } });
}

/** 分享路径的失败 → 一句人话。码的文案只在 knowledge-graph-failure.ts 一处；这里只改写「这一条不在了」的说法。 */
export function describeShareFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_CLAIM_NOT_FOUND") return "这条记忆已经不在了（或已撤回），请刷新后再试。";
  return code === null ? "没能完成，请稍后重试。" : describeHumanActionFailure(e);
}
