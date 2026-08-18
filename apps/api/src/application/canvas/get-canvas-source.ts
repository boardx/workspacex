/**
 * `getSource`（#1493 / UC-7.3 第一块）—— `[源码]` 视图的读取面。
 *
 * ## 读的判定：项目成员即可，**跨组只读放行**
 *
 * uc-7-3 A2 逐字：「**只读组画布**——打开别组画布时以 `只读` 态呈现」。读别组画布是
 * 契约行为，不是越权 ⇒ 本用例**不比对** `group_id`，只判项目成员身份。判定走
 * `authorize()` + 矩阵行 `read.ownGroup`（facilitator/groupLead/member 皆有，observer 无）
 * ——observer 被拒是 fail-closed：R5 说观察者只读「已发布且脱敏」的内容，进行中的
 * 组画布不是。契约 `err` 只有 `NO_PROJECT_ROLE` 一个拒绝码，任何 deny 都映到它。
 *
 * ## `INSTANCE_NOT_FOUND` 覆盖「不存在」与「别的组织」
 *
 * `canvas_instances` 走 RLS，别组织的实例在这条路径上查不到——两种情况同一个 404，
 * 不泄露跨组织存在性（契约 `CanvasError` 文件头逐字要求）。
 */
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { CanvasError } from "./errors";
import type { CanvasInstanceRepository } from "./instance-ports";

export const GET_CANVAS_SOURCE_ACTION = "read.ownGroup" as const;

export interface GetCanvasSourceDeps {
  readonly auth: AuthorizeDeps;
  readonly instances: CanvasInstanceRepository;
}

export interface GetCanvasSourceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly instanceId: string;
  readonly versionId?: string;
}

export interface GetCanvasSourceOutput {
  readonly markdown: string;
  readonly versionId: string;
  readonly contentHash: string;
}

export async function getCanvasSource(
  deps: GetCanvasSourceDeps,
  input: GetCanvasSourceInput,
): Promise<GetCanvasSourceOutput> {
  const instance = await deps.instances.findInstance(input.orgId, input.instanceId);
  if (instance === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: instance.workshopId,
    object: { kind: "project", id: instance.workshopId },
    action: GET_CANVAS_SOURCE_ACTION,
  });
  if (!decision.allowed) throw new CanvasError("NO_PROJECT_ROLE");

  const version = await deps.instances.findVersion(input.orgId, input.instanceId, input.versionId);
  // 指名的 versionId 不属于这个实例（或不存在）——契约 err 里没有「版本不存在」的码，
  // 归 `INSTANCE_NOT_FOUND`：调用方要的那个 (instance, version) 组合确实不存在。
  if (version === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  return {
    markdown: version.markdown,
    versionId: version.versionId,
    contentHash: version.contentHash,
  };
}
