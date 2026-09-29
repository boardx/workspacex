/**
 * CT06 —— W029 persist / notify 两个副作用阶段的工具体（经 effect-gateway 执行：`artifact.write` /
 * `notify.inapp`，重查权限、receipt 恰好一次）。
 *
 * - artifact.write：平台内部 PRD 工件 = 本实例 persist 阶段落库的 `PrdArtifact`（workflow_stage_outputs，
 *   由 Runtime 在副作用 finalize 后写入），对外只经 UC-WC-3 `GET /workflow-instances/:instanceId/output`
 *   读（可见性同 getInstance）。工件引用即该读取路径，不另造第二份存储（同一事实不声明两处）。
 * - notify.inapp：给发起人发一条站内通知（通知中心），同一实例只一条（sourceKey 去重）。
 */
import * as workContent from "@repo/contracts/work-content";
import type { NotificationPublisher } from "../notifications/notification-center";
import { toOrgId } from "../../domain/org-id";

export function prdArtifactRefOf(instanceId: string): string {
  return workContent.operations.getInstanceOutput.path.replace(":instanceId", encodeURIComponent(instanceId));
}

export async function publishPrdArtifact(args: { instanceId: string }): Promise<{ artifactRef: string }> {
  return { artifactRef: prdArtifactRefOf(args.instanceId) };
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
