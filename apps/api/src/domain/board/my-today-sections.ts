/**
 * F06 -- 「我的今天」四语义分区归属计算（uc-11-5 R3/R7/R12）。
 *
 * Pure. No clock (caller injects `now`), no I/O, no randomness -- same discipline as
 * `transition-matrix.ts`: this function IS the feature, and it must be exhaustively
 * testable without a database. Derived, not persisted (D-29 硬约束 / V9): nothing here
 * writes a "section" anywhere; every call recomputes from scratch.
 *
 * ## 范围收窄（如实记录 -- 这是本次会话对 F06 的收窄版，见 feature_list.json notes）
 *
 * uc-11-5 R3 的 ①「等我判断」区本来是三类来源合并：
 *   1. 需要我接受的 `inbox` 卡（AI 建的草稿，R2/R3 必须我接受）-- 依赖 F03（六来源自动
 *      汇入）才会真正产生 inbox 卡；F03 没做，但判定规则本身不依赖 F03 的存在，只依赖
 *      `status === 'inbox'` 这个 F01 已经建好的字段，所以这条按原文实现。
 *   2. 待我审批的 R2/R3 项（agent 停在审批点等我批）-- 依赖 F07/F08（权限包与授权流）
 *      建立的"等待授权"状态，这两个 feature 本次未做，**没有对应字段可读**（`waiting_input`
 *      不是本表的列，也不是 F01 的五态之一）。这个子类在本次实现里恒为空集，不是遗漏，
 *      是诚实地承认数据源不存在——不编造。
 *   3. 待我签署 / 待我验收的项（`status = review` 且验收人是我）-- 本表没有独立的
 *      "验收人"字段（那也是 F07/F08 权限包范围里才会建的东西）；本次用 `ownerUserId`
 *      近似"验收人是我"（一张 review 态的卡，负责人就是要对它签字的人），这是一个
 *      记录在案的近似，不是原文逐字实现。
 *
 * ③「AI 正在替我跑」原文要求 agent"运行中"这一实时信号（来自 agent 运行态服务，
 * F07 之外的另一个未建能力）。本次没有真实的 agent 运行时可查，用
 * `executor` 前缀为 `agent:` 且 `status === 'in_progress'` 作为"运行中"的代理判据
 * （一张卡的 executor 是 agent 且状态是进行中，视为该 agent 正在跑它）——这也是一个
 * 记录在案的近似。E5（agent 异常转区）与 E1（依赖失败降级）因此也不在本次范围内：
 * 没有真实的 agent 运行态服务可以"不可用"或"超预算中断"。
 */
import { isAgentIdentifier } from "./owner-identity";

export interface MyTodayCard {
  readonly id: string;
  readonly status: string;
  readonly ownerUserId: string | null;
  readonly executor: string | null;
  readonly dueAt: string | null; // ISO 8601
  readonly waitingOn: string | null;
}

export interface MyTodaySections {
  readonly awaiting_my_judgment: readonly string[];
  readonly my_push_today: readonly string[];
  readonly ai_running_for_me: readonly string[];
  readonly waiting_on_others: readonly string[];
}

export interface ComputeMyTodayInput {
  readonly cards: readonly MyTodayCard[];
  readonly userId: string;
  /** Injected clock -- "今天"/"逾期" must be testable without wall-clock flakiness. */
  readonly now: Date;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function dueTodayOrOverdue(dueAt: string | null, now: Date): boolean {
  if (dueAt === null) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() <= now.getTime() || isSameCalendarDay(due, now);
}

/**
 * ①→②→③→④ 优先级：每张卡只落一个分区（uc-11-5 R3 步骤 1 / R7 硬约束 / V7 AC2）。
 */
export function computeMyTodaySections(input: ComputeMyTodayInput): MyTodaySections {
  const { cards, userId, now } = input;

  const sections: {
    awaiting_my_judgment: string[];
    my_push_today: string[];
    ai_running_for_me: string[];
    waiting_on_others: string[];
  } = { awaiting_my_judgment: [], my_push_today: [], ai_running_for_me: [], waiting_on_others: [] };

  for (const card of cards) {
    if (card.ownerUserId !== userId) continue; // R5：本视图只呈现与本人相关的卡。

    // ① 等我判断（收窄版：inbox 待接受 + review 待验收/签署两类；R2/R3 待审批子类见头注）。
    if (card.status === "inbox" || card.status === "review") {
      sections.awaiting_my_judgment.push(card.id);
      continue;
    }

    // ② 今天该我推进：owner=我 且 (今天到期或已逾期) 且 status ∈ {todo, in_progress}。
    // D-27：未接受的 inbox 卡不进这一区（已经在上面的分支里被 ① 拦截，不会走到这里）。
    if ((card.status === "todo" || card.status === "in_progress") && dueTodayOrOverdue(card.dueAt, now)) {
      sections.my_push_today.push(card.id);
      continue;
    }

    // ③ AI 正在替我跑：executor 为 agent 且该卡在跑（近似判据见头注）且 owner=我（上面已保证）。
    if (isAgentIdentifier(card.executor) && card.status === "in_progress") {
      sections.ai_running_for_me.push(card.id);
      continue;
    }

    // ④ 下一步轮到别人：waiting_on 非空。
    if (card.waitingOn !== null && card.waitingOn.trim() !== "") {
      sections.waiting_on_others.push(card.id);
      continue;
    }
    // 不满足任何分区条件的卡不在本视图渲染（R3 步骤 1 末句）。
  }

  return sections;
}
