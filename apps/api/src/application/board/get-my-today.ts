/**
 * F06 -- 「我的今天」查询用例：四分区结果 + 底注当日汇总（uc-11-5 R3/R7/R12）。
 *
 * R5 权限：观察者对本视图 403（拒绝在 controller 层做，见 `board.controller.ts`）；
 * 其余角色跨项目聚合，聚合范围严格限于用户当前有权访问的项目——`projectIds: null` 交
 * 给仓储层，意味着"这个用户能看到的全部任务"，聚合边界仍然是仓储层的角色判断（同一套
 * `listVisibleWithin`），不是本用例自己发明第二套可见性规则（uc-11-5 R9："服务端先按
 * 各项目角色裁剪可见集合，再做分区归属计算"）。
 */
import { computeMyTodaySections, type MyTodayCard } from "../../domain/board/my-today-sections";
import { computeTodaySummary, DEFAULT_TODAY_SUMMARY_CONFIG, type TodaySummary } from "../../domain/board/today-summary";
import { renderCard, type RawTaskRow, type RenderedCard } from "../../domain/board/card-render";
import type { ProjectRole } from "../../domain/identity/roles";
import type { TaskRepository } from "./ports";
import type { DatabasePort } from "../ports/database.port";
import type { OrgId } from "../../domain/org-id";

export interface GetMyTodayDeps {
  readonly db: DatabasePort;
  readonly tasks: TaskRepository;
}

export interface GetMyTodayInput {
  readonly orgId: OrgId;
  readonly userId: string;
  readonly role: ProjectRole | "org-wide-admin";
  readonly groupId: string | null;
  readonly now: Date;
}

export interface GetMyTodayOutput {
  readonly sections: {
    readonly awaiting_my_judgment: readonly RenderedCard[];
    readonly my_push_today: readonly RenderedCard[];
    readonly ai_running_for_me: readonly RenderedCard[];
    readonly waiting_on_others: readonly RenderedCard[];
  };
  readonly summary: TodaySummary;
}

export async function getMyToday(deps: GetMyTodayDeps, input: GetMyTodayInput): Promise<GetMyTodayOutput> {
  const rows: readonly RawTaskRow[] = await deps.db.withTenant(input.orgId, (session) =>
    deps.tasks.listVisibleWithin(session, {
      orgId: input.orgId,
      userId: input.userId,
      projectIds: null, // 跨用户可见的全部项目聚合（R2 前置条件），可见性由仓储层的角色判断裁剪。
      role: input.role,
      groupId: input.groupId,
    }));

  const cards = rows.map(renderCard);
  const byId = new Map(cards.map((c) => [c.id, c]));

  const sectionInput: MyTodayCard[] = cards.map((c) => ({
    id: c.id,
    status: c.status,
    ownerUserId: c.ownerUserId,
    executor: c.executor === null ? null : c.executor.id,
    dueAt: c.dueAt,
    waitingOn: c.waitingOn,
  }));

  const sectionIds = computeMyTodaySections({ cards: sectionInput, userId: input.userId, now: input.now });

  const resolve = (ids: readonly string[]): RenderedCard[] => ids.map((id) => byId.get(id)!).filter((c): c is RenderedCard => c !== undefined);

  // V16 口径："今日 AI 完成 N 项" = 当日 executor 为 agent 且 status 转为 done 的卡数。
  // 本表没有"状态转为 done 的时间"这一独立字段（那需要 F01 之外再建一张状态转移时间轴，
  // 本次没有）；用 `updated_at`（F01 迁移已有的 touch 触发器）落在今天、且 status===done、
  // 且 executor 是 agent 近似它——记录在案的近似，不是编造：这是一次真实查询，只是口径
  // 比原文粗一档（"今天转为 done" vs "今天最后一次被改动且当前是 done"，两者在正常使用下
  // 通常重合，但一张卡如果先在今天转 done、又在今天被别的字段编辑，会被这个近似重复计入
  // 同一天——已知偏差，不隐瞒）。
  const isToday = (iso: string): boolean => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return (
      d.getUTCFullYear() === input.now.getUTCFullYear() &&
      d.getUTCMonth() === input.now.getUTCMonth() &&
      d.getUTCDate() === input.now.getUTCDate()
    );
  };
  const aiCompletedToday = cards.filter(
    (c) => c.status === "done" && c.executor?.kind === "agent" && isToday(c.updatedAt),
  ).length;

  const summary = computeTodaySummary({ aiCompletedCount: aiCompletedToday, config: DEFAULT_TODAY_SUMMARY_CONFIG });

  return {
    sections: {
      awaiting_my_judgment: resolve(sectionIds.awaiting_my_judgment),
      my_push_today: resolve(sectionIds.my_push_today),
      ai_running_for_me: resolve(sectionIds.ai_running_for_me),
      waiting_on_others: resolve(sectionIds.waiting_on_others),
    },
    summary,
  };
}
