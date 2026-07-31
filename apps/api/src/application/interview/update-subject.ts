/**
 * `updateSubject` —— 对象表逐行编辑（H 组，uc-6-7 R3-2）。
 *
 * 契约的 `updateSubject.in` 里每个可写字段都是可空的（`displayName` 等），
 * 这里原样透传给仓储——「这次不改」与「传 null」的区分在仓储层落地
 * （见 `subject-ports.ts` 的 `UpdateSubjectInput` 注释），应用层不做二次解释。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { SubjectRepository } from "./subject-ports";

export type UpdateSubjectResult = z.infer<typeof interview.operations.updateSubject.out>;
export type UpdateSubjectInputDto = z.infer<typeof interview.operations.updateSubject.in>;

export interface UpdateSubjectDeps {
  readonly repo: SubjectRepository;
}

export interface UpdateSubjectCommand {
  readonly orgId: OrgId;
  readonly input: UpdateSubjectInputDto;
}

function toResult(r: Awaited<ReturnType<SubjectRepository["update"]>>): UpdateSubjectResult {
  return {
    subjectId: r.subjectId,
    displayName: r.displayName,
    roleTitle: r.roleTitle,
    orgName: r.orgName,
    groupId: r.groupId,
    contactMask: r.contactMask ?? "",
    sourceKind: r.sourceKind,
  };
}

export async function updateSubject(
  deps: UpdateSubjectDeps,
  cmd: UpdateSubjectCommand,
): Promise<UpdateSubjectResult> {
  const record = await deps.repo.update({
    orgId: cmd.orgId,
    subjectId: cmd.input.subjectId,
    displayName: cmd.input.displayName,
    roleTitle: cmd.input.roleTitle,
    orgName: cmd.input.orgName,
    groupId: cmd.input.groupId,
    contact: cmd.input.contact,
  });
  return toResult(record);
}
