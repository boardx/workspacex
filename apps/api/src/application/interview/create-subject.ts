/**
 * `createSubject` —— 对象表新增一行（H 组，uc-6-7 R3-2）。
 *
 * ⚠ **范围边界**：本用例只负责「六列中能落盘的那几列」的写入。它**不做**：
 * · 联系方式加密/掩码算法本身（F98）——这里把明文原样交给仓储，由基础设施层决定
 *   如何生成 `contactMask`；应用层不假装知道加密怎么做。
 * · 权限校验（R5 的五档角色矩阵）——尚无任何一个 F80-F99 的已实现 feature 落地过
 *   访谈侧的角色鉴权，本用例保持与同层其它 F97 之前的写路径一致的边界，把这条
 *   报告为已知缺口而不是在此单独发明一套。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { SUBJECT_MODES } from "../../domain/interview/subject";
import type { SubjectRepository } from "./subject-ports";

export type CreateSubjectResult = z.infer<typeof interview.operations.createSubject.out>;
export type CreateSubjectInputDto = z.infer<typeof interview.operations.createSubject.in>;

export interface CreateSubjectDeps {
  readonly repo: SubjectRepository;
}

export interface CreateSubjectCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly input: CreateSubjectInputDto;
}

function toResult(r: Awaited<ReturnType<SubjectRepository["create"]>>): CreateSubjectResult {
  return {
    subjectId: r.subjectId,
    displayName: r.displayName,
    roleTitle: r.roleTitle,
    orgName: r.orgName,
    groupId: r.groupId,
    // 契约的 `contactMask` 是非空字符串（无联系方式 ≠ null，是「无遮盖对象」的空串）。
    contactMask: r.contactMask ?? "",
    sourceKind: r.sourceKind,
  };
}

export async function createSubject(
  deps: CreateSubjectDeps,
  cmd: CreateSubjectCommand,
): Promise<CreateSubjectResult> {
  // 契约的 `mode`/`backgroundAndQuestions` 尚未进 H 组的 `createSubject.in`
  // （契约只收六列里的四列 + sourceKind），所以这里恒取默认值，不凭空发明入参。
  const record = await deps.repo.create({
    orgId: cmd.orgId,
    displayName: cmd.input.displayName,
    roleTitle: cmd.input.roleTitle,
    orgName: cmd.input.orgName,
    groupId: cmd.input.groupId,
    contact: cmd.input.contact,
    sourceKind: cmd.input.sourceKind,
    mode: SUBJECT_MODES[1], // "interview" —— 契约未给这一列入参前的中性默认
    createdBy: cmd.actorId,
  });
  return toResult(record);
}
