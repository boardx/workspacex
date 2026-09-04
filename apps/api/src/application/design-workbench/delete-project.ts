/**
 * `deleteProject`（UC-17.8 B4.3）—— 硬删。仅 owner；未推送/已推送均可删（需求未对已推送项目
 * 的删除设限，见契约头注）。
 */
import { DesignProjectNotFoundError, DesignProjectNotOwnerError, type DesignProjectDeps } from "./project-shared";

export async function deleteProject(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string },
): Promise<{ readonly projectId: string }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  const deleted = await deps.projects.delete(input.projectId, input.ownerId);
  if (!deleted) throw new DesignProjectNotOwnerError();
  return { projectId: input.projectId };
}
