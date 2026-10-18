/**
 * CT06 —— W029 persist / notify 两个副作用阶段的工具体（经 effect-gateway 执行：`artifact.write` /
 * `notify.inapp`，重查权限、receipt 恰好一次）。
 *
 * - artifact.write：已装配 PRD 通过现有 materializeArtifact 写入不可变 Markdown 与来源文件。
 *   文件回执随 persist/effect 一起保存；UC-WC-3 按实例可见性重新读取并校验存储字节。
 * - notify.inapp：给发起人发一条站内通知（通知中心），同一实例只一条（sourceKey 去重）。
 */
import * as workContent from "@repo/contracts/work-content";
import type { NotificationPublisher } from "../notifications/notification-center";
import { toOrgId } from "../../domain/org-id";
import { materializeArtifact, type MaterializeDeps } from "../artifact/materialize-artifact";

export function prdArtifactRefOf(instanceId: string): string {
  return workContent.operations.getInstanceOutput.path.replace(":instanceId", encodeURIComponent(instanceId));
}

export async function publishPrdArtifact(deps: MaterializeDeps, args: {
  orgId: string; instanceId: string; initiatorUserId: string; prd: Record<string, unknown>;
}) {
  const prd = workContent.PrdArtifact.parse(args.prd);
  const markdown = [`# ${prd.title}`, "", "## 问题陈述", prd.problem.text,
    `来源：${prd.problem.evidenceRefs.join("、")}；置信度：${prd.problem.confidence}`,
    "", "## 需求", ...prd.requirements.map(r => `- ${r.id} [${r.priority}] ${r.text}`),
    "", "## 衡量指标", ...prd.metrics.map(m => `- ${m.name}：${m.definition}`), ""].join("\n");
  const file = await materializeArtifact(deps, {
    orgId: toOrgId(args.orgId), projectId: null, source: "ai-generated", title: prd.title,
    actorId: args.initiatorUserId, versionCreatorKind: "agent", versionChangeSource: "materialize",
    parts: { "content.md": Buffer.from(markdown, "utf8"), "provenance.json": Buffer.from(JSON.stringify({
      workflowId: "W029", instanceId: args.instanceId, prdDigest: prd.digest,
      synthesized: true, semanticSupportVerified: false,
    }) + "\n", "utf8") },
  });
  return { artifactRef: prdArtifactRefOf(args.instanceId), file: workContent.PrdFileReceipt.parse(file) };
}

export function prdPublishedNotifier(notifications: NotificationPublisher) {
  return async (args: { orgId: string; instanceId: string; userId: string; artifactRef: string }): Promise<{ notificationId: string }> => {
    const sourceKey = `workflow:${args.instanceId}:prd-published`;
    await notifications.publish({
      orgId: toOrgId(args.orgId),
      userId: args.userId,
      kind: "task",
      title: "PRD 已发布",
      body: `Workflow W029 的 PRD 已发布：${args.artifactRef}`,
      actionable: false,
      sourceKey,
    });
    return { notificationId: sourceKey };
  };
}
