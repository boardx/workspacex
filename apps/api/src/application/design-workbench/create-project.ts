/**
 * `createProject`（UC-17.8 B4.3）—— 新建设计项目。**任何组织成员都能用**。
 *
 * ⚠ `criteria`/`frames` 由服务端按契约常量 `DESIGN_PROJECT_INITIAL_CRITERIA` /
 *   `DESIGN_PROJECT_INITIAL_FRAMES` 填入快照——不接受调用方传入（契约 `createProject` 头注）。
 * ⚠ `chat` 恒为 `[]`：首次引导语是展示层文案，不落库（契约【待确认点 2】）。
 */
import { designWorkbench } from "@repo/contracts";
import { foldIntakeIntoCriteria, foldIntakeIntoProblem } from "./intake-questions";
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
  /** 迭代 13：澄清问答的结果（跳过的题不在数组里）。 */
  readonly intake?: readonly designWorkbench.IntakeAnswer[];
  /** 迭代 13（delta §4）：项目标签。 */
  readonly tags?: readonly string[];
  /** 迭代 13（delta §5.2）：新建时就能定原型主题；不给 ⇒ 库里的默认 `dark`。 */
  readonly theme?: "light" | "dark";
  /** 迭代 17：新建时就能定强调色；不给 ⇒ 库里的默认 `neutral`（不覆盖任何 token）。 */
  readonly accent?: designWorkbench.PrototypeAccent;
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
    // ⚠ `problem` 与 `intake` 同时给出时以 `problem` 为准：那是用户在预览里**编辑过**的
    // 最终文本，重新汇总会把他的修改覆盖掉。`intake` 这时只用来补 `criteria`。
    problem: (input.problem ?? "").trim() !== ""
      ? input.problem!
      : foldIntakeIntoProblem("", input.intake ?? []),
    criteria: foldIntakeIntoCriteria(input.intake ?? []),
    frames: designWorkbench.DESIGN_PROJECT_INITIAL_FRAMES,
    prototype: [],
    frameNotes: [],
    // 规范化与 `updateProject` 同一套：去空白、丢空串、去重（见那边的注释）。
    tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter((t) => t !== ""))],
    linkedFeedbackId: input.linkedFeedbackId ?? null,
  });

  /*
   * 主题与强调色都不在 `create` 的入参里（库里有 DEFAULT）——新建时指定了非默认值才补
   * 一次 update，而不是给 INSERT 多加两列只为两个几乎总是默认的字段。
   * 两者**合并成一次** update：分两次写会让 `updated_at` 跳两下，也多担一次半成功的风险。
   */
  const visual = {
    ...(input.theme !== undefined && input.theme !== "dark" ? { theme: input.theme } : {}),
    ...(input.accent !== undefined && input.accent !== "neutral" ? { accent: input.accent } : {}),
  };
  if (Object.keys(visual).length > 0) {
    await deps.projects.update(projectId, input.ownerId, visual);
  }

  return { project: await loadProjectView(deps, projectId) };
}
