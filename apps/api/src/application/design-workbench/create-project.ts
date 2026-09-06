/**
 * `createProject`（UC-17.8 B4.3）—— 新建设计项目。**任何组织成员都能用**。
 *
 * ⚠ `criteria`/`frames` 由服务端按契约常量 `DESIGN_PROJECT_INITIAL_CRITERIA` /
 *   `DESIGN_PROJECT_INITIAL_FRAMES` 填入快照——不接受调用方传入（契约 `createProject` 头注）。
 * ⚠ `chat` 恒为 `[]`：首次引导语是展示层文案，不落库（契约【待确认点 2】）。
 */
import { designWorkbench } from "@repo/contracts";
import { DesignProjectNameRequiredError, loadProjectView, type DesignProjectDeps, type DesignProjectView } from "./project-shared";
import type { ProjectTemplate } from "./project-ports";

export interface CreateProjectDeps extends DesignProjectDeps {
  readonly newProjectId: () => string;
}

export interface CreateProjectInput {
  readonly ownerId: string;
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem?: string;
  readonly linkedFeedbackId?: string;
}

export async function createProject(
  deps: CreateProjectDeps,
  input: CreateProjectInput,
): Promise<{ readonly project: DesignProjectView }> {
  if (input.name.trim() === "") throw new DesignProjectNameRequiredError();

  const projectId = deps.newProjectId();
  await deps.projects.create({
    id: projectId,
    ownerId: input.ownerId,
    name: input.name,
    template: input.template,
    problem: input.problem ?? "",
    criteria: designWorkbench.DESIGN_PROJECT_INITIAL_CRITERIA,
    frames: designWorkbench.DESIGN_PROJECT_INITIAL_FRAMES,
    prototype: [],
    linkedFeedbackId: input.linkedFeedbackId ?? null,
  });

  return { project: await loadProjectView(deps, projectId) };
}
