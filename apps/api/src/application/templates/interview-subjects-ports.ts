/**
 * F25 的仓储端口 —— `updateInterviewSubjects` 边界（由 `application` 定义，`infrastructure` 实现）。
 * 同 `grouping-ports.ts` 的并发冲突处置：仓储发现「更新了 0 行」抛
 * `InterviewSubjectsRevisionConflictError`，应用层翻译成 `VERSION_CHANGED`。
 */
import type { InterviewSubjectRow } from "../../domain/templates/interview-subject";

export interface UpdateInterviewSubjectsCommand {
  readonly projectId: string;
  readonly groupId: string;
  readonly subjects: readonly InterviewSubjectRow[];
  readonly expectedRevision: string;
}

export interface UpdatedInterviewSubjects {
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
}
