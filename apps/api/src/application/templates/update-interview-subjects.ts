/**
 * 用例：填观察/访谈对象表（F25 / `uc-2-2` R8 / 契约 `templates.updateInterviewSubjects`）。
 *
 * 编排很薄：角色门槛 → 仓储 upsert（并发冲突翻译）。
 *
 * ⚠ 权限：对象表嵌在组卡内，是「本组产出」的一部分——复用矩阵里已有的 `group.submitOutput`
 *   （`facilitator`/`groupLead` 可写，`member`/`observer` 不可），不新造一条平行判定
 *   （同 `update-grouping.ts` 复用 `agendaSegment.group` 的先例）。
 *
 * ⚠ 六列结构齐全（V9）由契约 `InterviewSubject` zod schema 在 HTTP 边界强制——`.strict()`
 *   拒绝多字段、每列 `z.string()` 拒绝缺字段，走 `.parse()` 这条路径不需要用例再判一次；
 *   契约的错误码表（`NO_PROJECT_ROLE`/`ROLE_INSUFFICIENT`/`VERSION_CHANGED`/
 *   `DEPENDENCY_UNAVAILABLE`）里也没有给「结构不齐」留码，本用例不发明第五个。
 *   `domain/templates/interview-subject.ts` 的 `hasAllSixColumns`/`findRowMissingColumns`
 *   仍然保留，供测试直接断言「六列齐全」这条结构性质本身（V9），不经由这条错误路径。
 *
 * ⚠ 本用例只落结构与填写：预约、提纲生成、转写自动回流是 06-itv 的活，这里不做。
 */
import { roleAllows } from "../../domain/identity/project-role-matrix";
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { InterviewSubjectRow } from "../../domain/templates/interview-subject";
import {
  InterviewSubjectsRevisionConflictError,
  type InterviewSubjectsRepository,
  type UpdatedInterviewSubjects,
} from "./interview-subjects-ports";

export type UpdateInterviewSubjectsErrorCode =
  | "NO_PROJECT_ROLE"
  | "ROLE_INSUFFICIENT"
  | "VERSION_CHANGED"
  | "DEPENDENCY_UNAVAILABLE";

export class UpdateInterviewSubjectsError extends Error {
  readonly reasonCode: UpdateInterviewSubjectsErrorCode;

  constructor(reasonCode: UpdateInterviewSubjectsErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "UpdateInterviewSubjectsError";
  }
}

/** 复用矩阵里已声明的 `group.submitOutput`——不新造一条判定（见文件头注）。 */
export function canUpdateInterviewSubjects(role: ProjectRole | null): boolean {
  return role !== null && roleAllows(role, "group.submitOutput");
}

export interface UpdateInterviewSubjectsInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly groupId: string;
  readonly actorProjectRole: ProjectRole | null;
  readonly subjects: readonly InterviewSubjectRow[];
  readonly expectedRevision: string;
}

export interface UpdateInterviewSubjectsDeps {
  readonly repo: InterviewSubjectsRepository;
}

export async function updateInterviewSubjectsUseCase(
  deps: UpdateInterviewSubjectsDeps,
  input: UpdateInterviewSubjectsInput,
): Promise<UpdatedInterviewSubjects> {
  if (input.actorProjectRole === null) {
    throw new UpdateInterviewSubjectsError("NO_PROJECT_ROLE");
  }
  if (!canUpdateInterviewSubjects(input.actorProjectRole)) {
    throw new UpdateInterviewSubjectsError("ROLE_INSUFFICIENT");
  }

  try {
    return await deps.repo.updateSubjects({
      orgId: input.orgId,
      projectId: input.projectId,
      groupId: input.groupId,
      subjects: input.subjects,
      expectedRevision: input.expectedRevision,
    });
  } catch (err) {
    if (err instanceof InterviewSubjectsRevisionConflictError) {
      throw new UpdateInterviewSubjectsError("VERSION_CHANGED");
    }
    throw new UpdateInterviewSubjectsError("DEPENDENCY_UNAVAILABLE");
  }
}
