/**
 * `listMyProjects`（UC-17.8 B4.3）—— 首页卡片网格：按名称过滤的「我的设计项目」。
 *
 * ⚠ 「我的」是 R4.4 的用户视角过滤，**不是**可见性边界（契约头注【待确认点 1】）——
 *   仓储 `listForOrg()` 取全组织的行，`ownerId` 过滤在这里做，不在 SQL 里；这与
 *   `listMyFeedbackDrafts` 的"owner 谓词在仓储 SQL 里"是刻意的对照，不是抄漏了一处。
 * ⚠ 不分页（同 `listMyFeedbackDrafts`/`listFeedback` 的理由：量级是"一个 PM 团队"）。
 */
import { loadOwnerNamesAndProject } from "./project-list-shared";
import type { DesignProjectDeps, DesignProjectView } from "./project-shared";

export async function listMyProjects(
  deps: DesignProjectDeps,
  input: { readonly ownerId: string; readonly q?: string },
): Promise<readonly DesignProjectView[]> {
  const rows = await deps.projects.listForOrg();
  const mine = rows.filter((r) => r.ownerId === input.ownerId);
  const q = input.q?.trim().toLowerCase();
  const filtered = q === undefined || q === "" ? mine : mine.filter((r) => r.name.toLowerCase().includes(q));
  return loadOwnerNamesAndProject(deps, filtered);
}
