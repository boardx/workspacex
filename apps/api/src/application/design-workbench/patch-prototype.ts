/**
 * 迭代 5 —— `patchPrototype`：人在画布上直接改（属性面板 / 删节点）。仅 owner。
 *
 * 与模型写回**同一条**路径：`applyPrototypePatch`（顺序 / 每步重验 / 整批原子），成功后记一条
 * `source: "user"` 的版本。区别只在失败的表达：模型的 patch 失败是「悄悄丢字段、其余照写」（那是
 * 一句对话的副产物），人的 patch 失败要**告诉人**为什么——抛 `PrototypePatchRejectedError(detail)`
 * ⇒ 400 `PROTOTYPE_PATCH_REJECTED`，前端原样显示 detail。
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
  constructor(readonly detail: string) {
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
  if (current.prototype.length === 0) throw new PrototypePatchRejectedError("还没有原型，先让模型画一版");

  let next: readonly designPrototype.PrototypeNode[];
  try {
    next = designPrototype.applyPrototypePatch(current.prototype, input.ops);
  } catch (e) {
    throw new PrototypePatchRejectedError(e instanceof Error ? e.message : "patch rejected");
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
