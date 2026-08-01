/**
 * 用例：读项目筹备页四子标签（F24 / `uc-2-2` R7-R8 / 契约 `templates.getProjectPrep`）。
 *
 * 编排很薄：查角色 → 查计数 → 交给 `domain/templates/project-prep.ts` 拼标签。
 * 「不存在」与「越权可见」两者不可分辨，统一走 `NO_PROJECT_ROLE`——同
 * `get-project-overview.ts` 头注引用的那条既有判例，本用例不重新发明区分。
 */
import { planProjectPrepTabs, type ProjectPrepTab } from "../../domain/templates/project-prep";
import type { ProjectPrepRepository } from "./project-prep-ports";
import type { ProjectRole } from "../../domain/identity/roles";

export type GetProjectPrepErrorCode = "NO_PROJECT_ROLE" | "DEPENDENCY_UNAVAILABLE";

export class GetProjectPrepError extends Error {
  readonly reasonCode: GetProjectPrepErrorCode;

  constructor(reasonCode: GetProjectPrepErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "GetProjectPrepError";
  }
}

export interface GetProjectPrepInput {
  readonly projectId: string;
  /** null = 调用者在这个项目没有任何角色——观察者（`observer`）也能读，只是不能写 R8。 */
  readonly actorProjectRole: ProjectRole | null;
}

export interface GetProjectPrepDeps {
  readonly repo: ProjectPrepRepository;
}

export interface GetProjectPrepOutput {
  readonly tabs: readonly ProjectPrepTab[];
}

export async function getProjectPrepUseCase(
  deps: GetProjectPrepDeps,
  input: GetProjectPrepInput,
): Promise<GetProjectPrepOutput> {
  if (input.actorProjectRole === null) throw new GetProjectPrepError("NO_PROJECT_ROLE");

  let counts;
  try {
    counts = await deps.repo.loadCounts(input.projectId);
  } catch {
    throw new GetProjectPrepError("DEPENDENCY_UNAVAILABLE");
  }
  if (counts === null) throw new GetProjectPrepError("NO_PROJECT_ROLE");

  return { tabs: planProjectPrepTabs(counts) };
}
