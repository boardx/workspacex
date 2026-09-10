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

/**
 * 迭代 11：把行上的平行视图（`prototype` + `frameLinks`）拼回 `applyPrototypePatch` 要的屏。
 * 库里已经是一列 `screens` 了，这一步是**用例层**的适配——`DesignProjectRow` 对外仍然是
 * 平行视图（契约 `DesignProject` 的形状，改它会波及整个 web 面，不在本 delta 范围内）。
 */
export function screensOf(row: {
  readonly frames: readonly string[];
  readonly prototype: readonly (designPrototype.PrototypeNode | null)[];
  readonly frameNotes: readonly string[];
  readonly frameLinks: readonly (readonly designPrototype.PrototypeLink[])[];
}) {
  // issue #3340：`null`（这页没画出来）落成**没有 `root` 字段**的屏——`applyPrototypePatch`
  // 的泛型 `T` 本来就按 `s.root === undefined` 处理未生成页（见 addScreen 的 root 可选）。
  //
  // ⚠ `frame` / `notes` 必须一起带进来（2026-09-10 实测：模型说「用 patch 追加了 5 页」，
  //   画布上还是 3 页）。`addScreen`/`removeScreen`/`renameScreen` 改的是**页本身**，而这个
  //   适配器此前只拼 root+links，页标签在往返中丢失 ⇒ 写回时 `frames` 没给 ⇒ `mergeScreens`
  //   拿旧的 3 个标签当页数，新加的页连同它们的树一起被截掉。泛型 `T` 会把这两个字段原样
  //   穿过去，所以补齐它们就是补齐「页数」这个事实本身。
  return row.prototype.map((root, i) => ({
    frame: row.frames[i] ?? "",
    ...(root === null ? {} : { root }),
    ...(row.frameNotes[i] === undefined || row.frameNotes[i] === "" ? {} : { notes: row.frameNotes[i]! }),
    links: row.frameLinks[i] ?? [],
  }));
}

/**
 * 把 `applyPrototypePatch` 的结果拼回 `DesignProjectPatch` 的四个平行字段。**四个一起给**——
 * 只给 `prototype` 会让页数以旧 `frames` 为准（见 `screensOf` 的 ⚠）。模型 patch 与人手改
 * 走同一个函数，避免第二处再漏一个字段。
 */
export function projectPatchOf(
  next: readonly {
    readonly frame?: string;
    readonly root?: designPrototype.PrototypeNode;
    readonly notes?: string;
    readonly links?: readonly designPrototype.PrototypeLink[];
  }[],
) {
  return {
    frames: next.map((s) => s.frame ?? ""),
    prototype: next.map((s) => s.root ?? null),
    frameNotes: next.map((s) => s.notes ?? ""),
    frameLinks: next.map((s) => [...(s.links ?? [])]),
  };
}

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

  // 迭代 11：patch 作用在**屏**上（`setLinks` 改的是屏级 links，且删节点要让指向它的 link 失效）。
  let next: readonly { readonly root?: designPrototype.PrototypeNode; readonly links?: readonly designPrototype.PrototypeLink[] }[];
  try {
    next = designPrototype.applyPrototypePatch(screensOf(current), input.ops);
  } catch (e) {
    if (e instanceof designPrototype.PrototypePatchError) throw new PrototypePatchRejectedError(e.reason, e.message, e.nodeId);
    throw new PrototypePatchRejectedError("INVALID_NODE", e instanceof Error ? e.message : "patch rejected");
  }

  // 与 UPDATE 同一事务落一条 user 版本（Codex：历史不能与当前原型分叉）。
  const written = await deps.projects.update(input.projectId, input.ownerId, projectPatchOf(next), {
    source: "user",
    summary: (input.summary ?? "").trim().slice(0, 120) || `手改 ${input.ops.length} 处`,
  });
  if (written === null) throw new DesignProjectNotOwnerError();
  const names = await ownerNamesFor(deps, [written.ownerId]);
  return { project: projectDesignProject(written, names.get(written.ownerId) ?? null) };
}
