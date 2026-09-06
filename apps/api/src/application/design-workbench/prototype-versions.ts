/**
 * 迭代 3 —— 原型版本历史三用例：列表 / 单条 / 恢复。
 *
 * 版本的**产生**不在这里：`append-project-chat.ts` 在 `prototype` 真的被写回后调 `recordVersion`
 * （source: "model"）；恢复在这里写回旧版内容后**再追加**一条 `source: "restore"`（历史只追加）。
 * 可见性同项目：列表/单条全组织可读；恢复仅 owner（写回走 `projects.update` 的 owner 谓词）。
 */
import { designPrototype } from "@repo/contracts";
import type { PrototypeVersionRow } from "./project-ports";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  ownerNamesFor,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";

export class PrototypeVersionNotFoundError extends Error {}

export type PrototypeVersionSummaryView = Omit<PrototypeVersionRow, "prototype" | "projectId">;
export type PrototypeVersionView = Omit<PrototypeVersionRow, "projectId">;

function summaryView(v: Omit<PrototypeVersionRow, "prototype">): PrototypeVersionSummaryView {
  return { id: v.id, seq: v.seq, source: v.source, summary: v.summary, frames: [...v.frames], createdAt: v.createdAt };
}

export async function listPrototypeVersions(deps: DesignProjectDeps, input: { readonly projectId: string }): Promise<{ readonly items: readonly PrototypeVersionSummaryView[] }> {
  const project = await deps.projects.get(input.projectId);
  if (project === null) throw new DesignProjectNotFoundError();
  const items = await deps.projects.listVersions(input.projectId);
  return { items: items.map(summaryView) };
}

export async function getPrototypeVersion(deps: DesignProjectDeps, input: { readonly projectId: string; readonly versionId: string }): Promise<{ readonly version: PrototypeVersionView }> {
  const project = await deps.projects.get(input.projectId);
  if (project === null) throw new DesignProjectNotFoundError();
  const v = await deps.projects.getVersion(input.projectId, input.versionId);
  if (v === null) throw new PrototypeVersionNotFoundError();
  return { version: { ...summaryView(v), prototype: [...v.prototype] } };
}

export async function restorePrototypeVersion(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly versionId: string },
): Promise<{ readonly project: DesignProjectView; readonly version: PrototypeVersionSummaryView }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  const v = await deps.projects.getVersion(input.projectId, input.versionId);
  if (v === null) throw new PrototypeVersionNotFoundError();
  // 旧版可能来自 id 之前的时代：补齐后写回，模型与画布看到的每个节点都可寻址。
  const prototype = designPrototype.ensurePrototypeIds(v.prototype);
  const written = await deps.projects.update(input.projectId, input.ownerId, { frames: v.frames, prototype });
  if (written === null) throw new DesignProjectNotOwnerError();
  const recorded = await deps.projects.recordVersion(input.projectId, input.ownerId, { source: "restore", summary: `恢复自 v${v.seq}`, frames: v.frames, prototype });
  if (recorded === null) throw new DesignProjectNotOwnerError();
  const names = await ownerNamesFor(deps, [written.ownerId]);
  return { project: projectDesignProject(written, names.get(written.ownerId) ?? null), version: summaryView(recorded) };
}
