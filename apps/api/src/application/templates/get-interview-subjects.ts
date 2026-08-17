/**
 * 用例：读观察/访谈对象表当前值（F960 / `uc-2-2` R8 V9 / 契约 `templates.getInterviewSubjects`）。
 *
 * 编排很薄：角色门槛（同 `get-project-prep.ts`，`observer` 可读，只是不能写）→ 仓储读。
 * 「没填过」是真实空态（`subjects: []`），不是错误——同 `get-project-topic.ts`/
 * `get-project-grouping.ts` 的先例。
 */
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { InterviewSubjectRow } from "../../domain/templates/interview-subject";
import type { InterviewSubjectsRepository } from "./interview-subjects-ports";

export type GetInterviewSubjectsErrorCode = "NO_PROJECT_ROLE" | "DEPENDENCY_UNAVAILABLE";

export class GetInterviewSubjectsError extends Error {
  readonly reasonCode: GetInterviewSubjectsErrorCode;

  constructor(reasonCode: GetInterviewSubjectsErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "GetInterviewSubjectsError";
  }
}

export interface GetInterviewSubjectsInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly groupId: string;
  readonly actorProjectRole: ProjectRole | null;
}

export interface GetInterviewSubjectsDeps {
  readonly repo: InterviewSubjectsRepository;
}

export interface GetInterviewSubjectsOutput {
  readonly subjects: readonly InterviewSubjectRow[];
  readonly revision: string;
}

export async function getInterviewSubjectsUseCase(
  deps: GetInterviewSubjectsDeps,
  input: GetInterviewSubjectsInput,
): Promise<GetInterviewSubjectsOutput> {
  if (input.actorProjectRole === null) throw new GetInterviewSubjectsError("NO_PROJECT_ROLE");

  try {
    return await deps.repo.getSubjects(input.orgId, input.projectId, input.groupId);
  } catch {
    throw new GetInterviewSubjectsError("DEPENDENCY_UNAVAILABLE");
  }
}
