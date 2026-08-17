/**
 * F25 的仓储端口 —— `updateInterviewSubjects` 边界（由 `application` 定义，`infrastructure` 实现）。
 * 同 `grouping-ports.ts` 的并发冲突处置：仓储发现「更新了 0 行」抛
 * `InterviewSubjectsRevisionConflictError`，应用层翻译成 `VERSION_CHANGED`。
 *
 * ⚠ F960（2026-08-17 delta）：加 `orgId`（多租户隔离必须显式传，同 `grouping-ports.ts`
 *   在 F950 时补的先例）+ `getSubjects` 方法（支撑新增的 `getInterviewSubjects` GET，
 *   见 `packages/contracts/src/templates.ts` 头注引用的同一条已获授权的裁决类别）。
 */
import type { OrgId } from "../../domain/org-id";
import type { InterviewSubjectRow } from "../../domain/templates/interview-subject";

export interface UpdateInterviewSubjectsCommand {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly groupId: string;
  readonly subjects: readonly InterviewSubjectRow[];
  readonly expectedRevision: string;
}

export interface UpdatedInterviewSubjects {
  readonly subjects: readonly InterviewSubjectRow[];
  readonly revision: string;
}

export interface GetInterviewSubjectsResult {
  readonly subjects: readonly InterviewSubjectRow[];
  readonly revision: string;
}

export class InterviewSubjectsRevisionConflictError extends Error {
  constructor() {
    super("interview subjects revision changed concurrently");
    this.name = "InterviewSubjectsRevisionConflictError";
  }
}

export interface InterviewSubjectsRepository {
  updateSubjects(cmd: UpdateInterviewSubjectsCommand): Promise<UpdatedInterviewSubjects>;

  /**
   * 读当前值。这一组从未有人填过 ⇒ `{subjects: [], revision: "0"}`（真实空态，不是
   * `NOT_FOUND`——同 `getProjectTopic`/`getProjectGrouping` 的先例，"没填过" 不是错误）。
   */
  getSubjects(orgId: OrgId, projectId: string, groupId: string): Promise<GetInterviewSubjectsResult>;
}

/** DI token（同 `blueprint-persistence-ports.ts` 的先例，token 与 port 挂同一个文件）。 */
export const INTERVIEW_SUBJECTS_REPOSITORY = Symbol("InterviewSubjectsRepository");
