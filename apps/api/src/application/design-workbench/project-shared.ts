/**
 * UC-17.8 B4.3 —— 六条设计项目用例共用的错误类型 + 投影到契约 `DesignProject` 的函数。
 *
 * `ownerName` 的解析同 `list-feedback.ts` 对 `submitterName` 的做法：批量查一次显示名，
 * 复用既有的 `FeedbackSubmitterDirectory`——同一个"userId → 显示名"端口没有理由为设计项目
 * 再造一份（本仓「同一事实不得声明在两处」纪律不只管字段，也管"怎么查一个人的名字"这件事）。
 */
import type { designWorkbench } from "@repo/contracts";
import type { z } from "zod";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import type { LoggerPort } from "../ports/logger.port";
import type { FeedbackSubmitterDirectory } from "../feedback/notification-ports";
import type { OrgId } from "../../domain/org-id";
import type { DesignProjectRepository, DesignProjectRow } from "./project-ports";
import { isShareStale } from "./share-snapshot";

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
  /**
   * B6.3：`pushToInbox` 给来源反馈提交人发「已生成设计方案」邮件用。**可选**——只有推送这
   * 一条用例需要，controller 注入；单测按需注入 fake 断言"发了/没发"。`mail`/`logger`/
   * `submitters` 三者缺任一即不发（没有 logger 就没法按纪律记"best-effort 失败"，宁可不发）。
   *
   * B6.4 可观测性：`logger` 同时用于 `pushToInbox` 事务成功后那条结构化 `info`；`traceId`
   * 由 controller 透传 `traceIdOf(req)`，让它与 `AllExceptionsFilter` 记的错误按同一个 id 关联。
   * 放在共用 deps 上是为了六条用例不各自长出一个 `logger` 字段。
   */
  readonly mail?: TransactionalMailTransport;
  readonly logger?: LoggerPort;
  readonly traceId?: string;
}

/**
 * 迭代 22：发布状态的读投影。
 *
 * ⚠ `token` **只给 owner**：组织内全员可读说的是"看得见这个项目"，不是"可以替 owner 把它
 *   发到组织外面去"。那两件事之间隔着一次明确的发布动作，而令牌就是那次动作的凭证。
 *   `viewerId` 不给（老调用点）⇒ 一律不给令牌——默认方向朝安全那边倒。
 */
function shareView(row: DesignProjectRow, viewerId: string | null): DesignProjectView["share"] {
  if (row.share === undefined) return null;
  return {
    token: viewerId !== null && viewerId === row.ownerId ? row.share.token : null,
    scope: row.share.scope,
    publishedAt: row.share.publishedAt,
    stale: isShareStale(row.share.snapshot, row),
  };
}

export function projectDesignProject(row: DesignProjectRow, ownerName: string | null, viewerId: string | null = null): DesignProjectView {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    problem: row.problem,
    criteria: [...row.criteria],
    frames: [...row.frames],
    prototype: [...row.prototype],
    frameNotes: [...row.frameNotes],
    // 迭代 13：原型自己的明暗主题。行里没有（这个字段之前建的项目）⇒ `dark`，
    // 与它出现之前的行为逐字相同。
    theme: row.theme ?? "dark",
    // 迭代 17：强调色档位。行里没有（这个字段之前建的项目）⇒ `neutral` = 不覆盖任何 token，
    // 与它出现之前的行为逐字相同：老项目打开来一个像素都不会变。
    accent: row.accent ?? "neutral",
    // 迭代 13（delta §4）：老行没有这一列 ⇒ 空数组。
    tags: [...(row.tags ?? [])],
    // 迭代 13：参考图的元信息（不含字节）；老行没有这一列 ⇒ 空数组。
    refImages: [...(row.refImages ?? [])],
    pushed: row.pushed,
    pushedAt: row.pushedAt,
    linkedFeedbackId: row.linkedFeedbackId,
    githubIssueUrl: row.githubIssueUrl,
    githubIssueNumber: row.githubIssueNumber,
    chat: [...row.chat],
    share: shareView(row, viewerId),
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
export async function loadProjectView(
  deps: DesignProjectDeps,
  projectId: string,
  /** 迭代 22：谁在读——只影响 `share.token` 给不给（见 `shareView`）。不给 ⇒ 不给令牌。 */
  viewerId: string | null = null,
): Promise<DesignProjectView> {
  const row = await deps.projects.get(projectId);
  if (row === null) throw new DesignProjectNotFoundError();
  const names = await ownerNamesFor(deps, [row.ownerId]);
  return projectDesignProject(row, names.get(row.ownerId) ?? null, viewerId);
}
