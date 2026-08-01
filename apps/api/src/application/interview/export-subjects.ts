/**
 * `exportSubjects` —— 批量导出对象表，默认不含联系方式（F98，uc-6-7 R8/R9/AC7）。
 *
 * ## 为什么排除不是"掩码它"，而是"不出现这个字段"
 *
 * `listSubjects` 的每一行恒带 `contactMask`（如 `138 •••• 2049`）——那是"看得见但看不清"。
 * R8 说的是「批量导出**默认不含联系方式**」，字面上更严：导出产物里连掩码字符串都不该
 * 出现，不是"导出也遮盖"。所以 `ExportedSubjectRow`（`export-file-ports.ts`）这个类型
 * 从结构上就没有 contact 相关字段——和 `acceptCandidate` 不可能自动写入联系方式同一个
 * 手法：不是运行时判断要不要带，是数据结构里压根没有能带的地方。
 *
 * ## `includeContact` 为什么在这个函数体里看不到分支
 *
 * 契约把它钉死成 `z.literal(false)`——"含联系方式的导出是独立授权动作"，这条独立动作
 * 本身**不在**当前契约里（`KNOWN_CONTRACT_GAPS` 未记，视为尚未设计，属已知缺口，
 * 见文件尾）。`true` 这个值在类型层面就到不了这里，本函数因此不需要也不应该为一个
 * 类型系统已经排除的分支写代码。
 *
 * ## 范围（如实报告的缺口，而不是悄悄按最简单的路径做完）
 *
 * `scope.kind === "project"` 时按 `SubjectRepository.listByProjectScope` 取该项目
 * 全部组的对象；`"research"` / `"none"` 时返回空列表——访谈对象（`interview_subjects`）
 * 只通过 `group_id` 挂到项目侧的组，模型里没有"研究项目范围的对象"或"无项目对象"
 * 这两个概念（`groupId === null` 的对象确实存在，但契约的 `InterviewScope` 没有
 * "未归组"这个 kind 可以选中它们），如实登记而不是编一个语义。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { decideSubjectVisibility } from "./subject-visibility-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DecisionIdFactory } from "../identity/ports";
import type { GuardedSubjectRow, SubjectRepository } from "./subject-ports";
import type { ExportedSubjectRow, ExportFileStore } from "./export-file-ports";

export type ExportSubjectsResult = z.infer<typeof interview.operations.exportSubjects.out>;
export type ExportSubjectsInputDto = z.infer<typeof interview.operations.exportSubjects.in>;

export interface ExportSubjectsDeps {
  readonly repo: SubjectRepository;
  readonly files: ExportFileStore;
  readonly decisions: DecisionIdFactory;
}

export interface ExportSubjectsCommand {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly input: ExportSubjectsInputDto;
}

async function discloseRows(
  deps: ExportSubjectsDeps,
  orgId: OrgId,
  viewerUserId: string,
  rows: GuardedSubjectRow[],
): Promise<ExportedSubjectRow[]> {
  if (rows.length === 0) return [];
  const groupCtxCache = new Map<
    string,
    { orgRole: string | null; teamId: string | null; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null }
  >();
  const orgMembership = await deps.repo.orgMembershipOf(orgId, viewerUserId);

  const out: ExportedSubjectRow[] = [];
  for (const row of rows) {
    let ctx = row.facts.groupId === null ? null : groupCtxCache.get(row.facts.groupId) ?? null;
    if (ctx === null && row.facts.groupId !== null) {
      ctx = await deps.repo.viewerContextForGroup(orgId, viewerUserId, row.facts.groupId);
      groupCtxCache.set(row.facts.groupId, ctx);
    }
    const decision = decideSubjectVisibility({
      decisionId: deps.decisions.next(),
      subject: row.facts,
      viewer: { userId: viewerUserId, projectRole: ctx?.projectRole ?? null },
      orgRole: (ctx?.orgRole ?? orgMembership.orgRole) as OrgRole | null,
      viewerTeamId: ctx?.teamId ?? orgMembership.teamId,
    });
    const disclosed = discloseDecided(row.item, decision);
    if (!isDisclosed(disclosed)) continue;
    const p = disclosed.payload;
    // ⚠ 逐字段显式列出，不用 `...p` 展开——展开会在 `SubjectRecord` 未来加字段时
    // 悄悄把新字段（比如某天加回 contact 相关列）一起带进导出产物。R8 的「默认不含
    // 联系方式」必须是一份显式白名单，不能依赖"当前恰好没有别的敏感字段"这件事。
    out.push({
      subjectId: p.subjectId,
      displayName: p.displayName,
      roleTitle: p.roleTitle,
      orgName: p.orgName,
      groupId: p.groupId,
      sourceKind: p.sourceKind,
    });
  }
  return out;
}

export async function exportSubjects(
  deps: ExportSubjectsDeps,
  cmd: ExportSubjectsCommand,
): Promise<ExportSubjectsResult> {
  const { orgId, viewerUserId, input } = cmd;
  const rows: GuardedSubjectRow[] =
    input.scope.kind === "project" && input.scope.projectId !== null
      ? await deps.repo.listByProjectScope(orgId, input.scope.projectId)
      : []; // "research" / "none"：模型里没有对应的对象集合，见文件头。

  const disclosed = await discloseRows(deps, orgId, viewerUserId, rows);
  const fileId = await deps.files.put(orgId, disclosed);
  return { fileId };
}
