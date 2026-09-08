/**
 * `updateProject`（UC-17.8 B4.3）—— 编辑弹窗：只改 `name`/`template`/`problem`。仅 owner。
 * ⚠ 不改 `criteria`/`frames`/`chat`——那些走各自的操作（契约 `updateProject` 头注）。
 */
import {
  DesignProjectNameRequiredError,
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  loadProjectView,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";
import type { ProjectTemplate } from "./project-ports";

export interface UpdateProjectInput {
  readonly projectId: string;
  readonly ownerId: string;
  readonly name?: string;
  readonly template?: ProjectTemplate;
  readonly problem?: string;
  /** 迭代 13（delta §5.2）：原型的明暗主题——是原型的属性，不是看的人的偏好。 */
  readonly theme?: "light" | "dark";
}

export async function updateProject(
  deps: DesignProjectDeps,
  input: UpdateProjectInput,
): Promise<{ readonly project: DesignProjectView }> {
  if (input.name !== undefined && input.name.trim() === "") throw new DesignProjectNameRequiredError();

  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  const updated = await deps.projects.update(input.projectId, input.ownerId, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.template !== undefined ? { template: input.template } : {}),
    ...(input.problem !== undefined ? { problem: input.problem } : {}),
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
  });
  if (updated === null) throw new DesignProjectNotOwnerError();

  return { project: await loadProjectView(deps, input.projectId) };
}
