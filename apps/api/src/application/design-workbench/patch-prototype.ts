/**
 * 迭代 5 —— `patchPrototype`：人在画布上直接改（属性面板 / 删节点）。仅 owner。
 *
 * 与模型写回**同一条**路径：`applyPrototypePatch`（顺序 / 每步重验 / 整批原子），成功后记一条
 * `source: "user"` 的版本。区别只在失败的表达：模型的 patch 失败是「悄悄丢字段、其余照写」（那是
 * 一句对话的副产物），人的 patch 失败要**告诉人**为什么——抛 `PrototypePatchRejectedError(reason, detail, nodeId)`
 * ⇒ 400 `PROTOTYPE_PATCH_REJECTED` + 闭集 `patchReason` + `nodeId`（全局过滤器只放行闭集，detail 进日志）。
 */
import { designPrototype } from "@repo/contracts";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  ownerNamesFor,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";

export class PrototypePatchRejectedError extends Error {
  /**
   * `reason` 是契约闭集 `PrototypePatchRejectReason`（经全局过滤器回到前端）；`nodeId` 是它指的节点；
   * `detail` 是自由文本，只进日志。
   */
  constructor(readonly reason: designPrototype.PrototypePatchRejectReason, readonly detail: string, readonly nodeId?: string) {
    super(detail);
    this.name = "PrototypePatchRejectedError";
  }
}

export async function patchPrototype(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly ops: designPrototype.DesignPrototypePatch; readonly summary?: string },
): Promise<{ readonly project: DesignProjectView }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  if (current.prototype.length === 0) throw new PrototypePatchRejectedError("NO_PROTOTYPE", "project has no prototype yet");

  let next: readonly designPrototype.PrototypeNode[];
  try {
    next = designPrototype.applyPrototypePatch(current.prototype, input.ops);
  } catch (e) {
    if (e instanceof designPrototype.PrototypePatchError) throw new PrototypePatchRejectedError(e.reason, e.message, e.nodeId);
    throw new PrototypePatchRejectedError("INVALID_NODE", e instanceof Error ? e.message : "patch rejected");
  }

  // 与 UPDATE 同一事务落一条 user 版本（Codex：历史不能与当前原型分叉）。
  const written = await deps.projects.update(input.projectId, input.ownerId, { prototype: next }, {
    source: "user",
    summary: (input.summary ?? "").trim().slice(0, 120) || `手改 ${input.ops.length} 处`,
  });
  if (written === null) throw new DesignProjectNotOwnerError();
  const names = await ownerNamesFor(deps, [written.ownerId]);
  return { project: projectDesignProject(written, names.get(written.ownerId) ?? null) };
}
