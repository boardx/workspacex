/**
 * `listMyProjects`（UC-17.8 B4.3）—— 首页卡片网格：按名称过滤的「我的设计项目」。
 *
 * ⚠ 「我的」是 R4.4 的用户视角过滤，**不是**可见性边界（契约头注【待确认点 1】）——
 *   仓储 `listForOrg()` 取全组织的行，`ownerId` 过滤在这里做，不在 SQL 里；这与
 *   `listMyFeedbackDrafts` 的"owner 谓词在仓储 SQL 里"是刻意的对照，不是抄漏了一处。
 * ⚠ 不分页（同 `listMyFeedbackDrafts`/`listFeedback` 的理由：量级是"一个 PM 团队"）。
 *
 * ## 迭代 13（delta §4）：顺序与标签
 *
 * **排序不在这里**——仓储的 `listForOrg()` 已按 `updated_at DESC` 返回（V65 要求排序在
 * 服务端的**数据库**那一侧）。这里再 `sort` 一次就是第二处声明的顺序，且将来一分页，
 * 页内重排会让顺序看起来是随机的。所以本函数只过滤，不排序。
 *
 * `tags` 过滤取**交集**：选了「后台」和「移动端」，要的是两者都有的项目。并集在标签数
 * 一多时等于没过滤——那正是用户加上第二个标签时想避免的事。
 */
import { loadOwnerNamesAndProject } from "./project-list-shared";
import type { DesignProjectDeps, DesignProjectView } from "./project-shared";

export async function listMyProjects(
  deps: DesignProjectDeps,
  input: { readonly ownerId: string; readonly q?: string; readonly tags?: readonly string[] },
): Promise<readonly DesignProjectView[]> {
  const rows = await deps.projects.listForOrg();
  const mine = rows.filter((r) => r.ownerId === input.ownerId);
  const q = input.q?.trim().toLowerCase();
  const byName = q === undefined || q === "" ? mine : mine.filter((r) => r.name.toLowerCase().includes(q));
  const wanted = (input.tags ?? []).map((t) => t.trim()).filter((t) => t !== "");
  const filtered =
    wanted.length === 0 ? byName : byName.filter((r) => wanted.every((t) => (r.tags ?? []).includes(t)));
  return loadOwnerNamesAndProject(deps, filtered);
}
