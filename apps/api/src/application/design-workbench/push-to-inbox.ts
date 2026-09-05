/**
 * `pushToInbox`（UC-17.8 B4.3）—— 推送确认弹窗 → 收件箱出现一条「设计方案」条目。仅 owner。
 *
 * ## 幂等 = upsert（契约头注逐字，不重复）
 *
 * 幂等键是 `projectId`：`design_projects` 一行至多产生一条收件箱条目（B4.2 没有第三张表，
 * "收件箱条目"是 `design_projects` 的一次投影，见 `inbox-projection.ts` 的
 * `buildDesignInboxItems`）。重复推送更新同一行的 `pushed_at`/`push_note`，`inboxCode`
 * 不变——因为它是按 `created_at` 顺序算出来的（同 B/R/E 的 `assignCodes`），
 * `design_projects.created_at` 从不改变，所以 `D-n` 天然稳定，不需要额外的"锁定编号"逻辑。
 *
 * ## 事务边界：仓储 `pushToInbox` 方法内一次数据库事务
 *
 * 「标记 pushed + 回写来源反馈的 `resolved_by_design_id`」在**同一次** `withTenant` 调用里
 * 完成（见 `pg-design-project-repository.ts`）——不是这里先调一次"标记推送"、再调一次"回写
 * 反馈"两个独立仓储调用：那样任何一步失败都会让两个方向的外键在一段时间内不一致
 * （方案说自己链接反馈，反馈却不知道自己被谁解决了，或反过来），恰恰是契约头注
 * 「确认这个形状不会让两个方向的写各自漂移」点名要避免的。用例层因此只做一次仓储调用，
 * 不在这里手动拼两步。
 *
 * ## 「已生成 D-X」状态事件——**没有落库**，这是本轮刻意的取舍
 *
 * B4.3 backlog 条目原文要求推送时给来源反馈"追加一条状态事件「已生成 D-X」"。检查过
 * `product_feedback_status_events` 的形状后发现**装不下**：
 *   · 列 `to_status`/`from_status` 都有 `CHECK (... IN ('待处理','已进入迭代','已修复','不做'))`，
 *     "已生成 D-2"根本不是这四个状态之一，塞进去要么撒谎成某个真实状态（反馈的状态机没有因为
 *     "被设计方案解决"而改变——它仍然是"待处理"或别的什么，硬编一个不存在的转移会让
 *     `listFeedbackStatusEvents` 的时间线上出现一条"从 X 转到 X"的假事件）。
 *   · 契约 `feedback-loop.ts` 的 `listFeedbackStatusEvents.out.events[].toStatus` 类型是
 *     `FeedbackStatus`（闭集四值）——这是**契约冻结**的部分（任务书明确不改 `feedback-loop.ts`），
 *     就算数据库那列的 CHECK 能想办法绕过去，契约的 zod 校验也会在读出来的那一刻直接拒绝
 *     这一行，`listFeedbackStatusEvents` 会 500，而不是"多一条看得懂的历史"。
 * 所以这里**只**回写 `resolved_by_design_id`（结构化、可查询的事实——drawer 要展示"源自 B-3 /
 * 已生成 D-2"关联标，读的正是这个外键 + `inbox-projection.ts` 的投影，不需要一条事件记录）。
 * "反馈状态时间线里也能看到这次关联"这件事**没有**落地，属于已知缺口：`feedback-loop` 束的
 * 状态事件表形状不支持"非状态转移"的事件类型，要支持需要改那张表（加一个不受 CHECK 约束的
 * `event_type` 维度，或者新建一张更通用的事件表），两者都超出 B4.3（只改 `design-workbench`
 * 束）的范围，也超出本任务"不改 feedback-loop 契约"的边界——留给后续束处理。
 *
 * ## 这次事务是**可观测的**（UC-17.8 B6.4）
 *
 * 成功时记一条结构化 `info`（`deps.logger` 可选，见 `DesignProjectDeps`）：`projectId` /
 * `ownerId` / 是否回写了反馈（仓储返回的 `resolvedFeedback`，与 `linkedFeedbackId` 非空但
 * 反馈行已不在的情形区分开）/ 是否重复推送（upsert 命中：推送前 `pushed` 已为 true）/
 * `inboxCode` / 耗时。**不记** `note` 正文与项目名。失败路径不在这里记——异常一路抛到
 * `AllExceptionsFilter`，那里按同一个 `traceId` 落 `error_logs`。
 */
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";
import { ownerNamesFor } from "./project-shared";

export async function pushToInbox(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly note?: string },
): Promise<{ readonly project: DesignProjectView; readonly inboxCode: string }> {
  const startedAt = Date.now();
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  const result = await deps.projects.pushToInbox(input.projectId, input.ownerId, input.note);
  if (result === null) throw new DesignProjectNotOwnerError();
  const pushedAt = Date.now();

  // `D-n`：同前缀（B/R/E 的既有先例）内按创建顺序赋号——只在已推送的行里算，
  // 同 `inbox-projection.ts` 的 `assignCodes`，这里不重新实现一份，只是本用例的返回值
  // 需要立刻知道这一条的编号（controller 的 `out.inboxCode` 不经过一次 listInbox 往返）。
  const allPushed = (await deps.projects.listForOrg())
    .filter((r) => r.pushed)
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  const index = allPushed.findIndex((r) => r.id === result.project.id);
  const inboxCode = `D-${index >= 0 ? index + 1 : allPushed.length}`;

  const names = await ownerNamesFor(deps, [result.project.ownerId]);

  deps.logger?.info("design-workbench: pushToInbox", {
    traceId: deps.traceId ?? "design-workbench-push",
    orgId: deps.orgId,
    projectId: result.project.id,
    ownerId: input.ownerId,
    repeatPush: current.pushed,
    linkedFeedback: current.linkedFeedbackId !== null,
    resolvedFeedback: result.resolvedFeedback,
    notePresent: input.note !== undefined,
    inboxCode,
    transactionMs: pushedAt - startedAt,
    durationMs: Date.now() - startedAt,
  });

  return {
    project: projectDesignProject(result.project, names.get(result.project.ownerId) ?? null),
    inboxCode,
  };
}
