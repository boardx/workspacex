/**
 * UC-17.8 B4.3 —— 六条设计项目用例共用的错误类型 + 投影到契约 `DesignProject` 的函数。
 *
 * `ownerName` 的解析同 `list-feedback.ts` 对 `submitterName` 的做法：批量查一次显示名，
 * 复用既有的 `FeedbackSubmitterDirectory`——同一个"userId → 显示名"端口没有理由为设计项目
 * 再造一份（本仓「同一事实不得声明在两处」纪律不只管字段，也管"怎么查一个人的名字"这件事）。
 */
import type { designWorkbench } from "@repo/contracts";
import type { z } from "zod";
import type { FeedbackSubmitterDirectory } from "../feedback/notification-ports";
import type { OrgId } from "../../domain/org-id";
import type { DesignProjectRepository, DesignProjectRow } from "./project-ports";

export type DesignProjectView = z.infer<typeof designWorkbench.DesignProject>;

/** 不存在（契约 `PROJECT_NOT_FOUND`：与草稿不同,这是**真的不存在**,不是"不是你的"——见 project-ports.ts 头注）。 */
export class DesignProjectNotFoundError extends Error {}
/** 改/删/推送/发消息时请求者不是该项目 owner（契约 `NOT_PROJECT_OWNER`）。 */
export class DesignProjectNotOwnerError extends Error {}
/** `name` 为空或超过 200 字（契约 `NAME_REQUIRED`，`createProject`/`updateProject` 共用）。 */
export class DesignProjectNameRequiredError extends Error {}

export interface DesignProjectDeps {
  readonly projects: DesignProjectRepository;
  readonly orgId: OrgId;
  readonly submitters?: FeedbackSubmitterDirectory;
}

export function projectDesignProject(row: DesignProjectRow, ownerName: string | null): DesignProjectView {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    problem: row.problem,
    criteria: [...row.criteria],
    frames: [...row.frames],
    pushed: row.pushed,
    pushedAt: row.pushedAt,
    linkedFeedbackId: row.linkedFeedbackId,
    chat: [...row.chat],
    ownerId: row.ownerId,
    ownerName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 一批项目各自 owner 的显示名——一次查询，按 ownerId 去重（同 `list-feedback.ts` 的写法）。 */
export async function ownerNamesFor(
  deps: DesignProjectDeps,
  ownerIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (deps.submitters === undefined || ownerIds.length === 0) return new Map();
  return deps.submitters.displayNamesForUserIds([...new Set(ownerIds)]);
}

/** `get` + 投影，找不到就抛——update / appendChat / delete / pushToInbox 的 owner 校验前置读都要这一步。 */
export async function loadProjectView(deps: DesignProjectDeps, projectId: string): Promise<DesignProjectView> {
  const row = await deps.projects.get(projectId);
  if (row === null) throw new DesignProjectNotFoundError();
  const names = await ownerNamesFor(deps, [row.ownerId]);
  return projectDesignProject(row, names.get(row.ownerId) ?? null);
}
