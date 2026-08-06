/**
 * `getThread` —— 读线程详情，**四视角投影就发生在这里**。
 *
 * ## 观察者降级是「服务端不下发」，不是「前端不渲染」（I-5）
 *
 * 下面 `messages` 的过滤发生在**取到正文之后、组装响应之前**，返回的数组里
 * 根本没有那几条。这与「返回全部消息、前端按角色隐藏」的区别不是风格问题：
 * 后者的数据已经过网了，任何一个 devtools、任何一次日志采样、任何一个第三方
 * 前端都能拿到它，而界面上什么都看不出来。
 *
 * 反证在 `tests/chat/observer-downgrade-server-side.test.ts`：删掉过滤那一行，
 * 断言「转写正文不出现在响应 JSON 里」必须当场变红。不红 ⇒ 被测的是前端。
 *
 * ## 能力集合是「没有」，不是「有但禁用」
 *
 * 观察者的 `capabilities` 里不含任何写能力（`CHAT_WRITE_CAPABILITIES` 一个都没有）。
 * 返回一个带 disabled 标记的写能力，等于把授权判定交给客户端执行。
 *
 * ## ⚠ 契约缺口（已发现，未擅自修补）
 *
 * `chat.Message` 是 `.strict()` 且**没有正文字段**——没有 `body` / `text`。
 * 于是「一条消息说了什么」在契约上无处安放。本实现把转录卡 / 产物卡的可读文本放进
 * `card`（`usecases.md` 明写「观察者：转录卡与批准卡不在响应体里」，说明 card 是
 * 承载这类内容的地方），正文另需契约补字段。**契约由人改**（ADR-020），此处只登记。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import {
  capabilitiesFor, observerMayReadMessage, PERSONAL_THREAD_CAPABILITIES,
} from "../../domain/chat/thread-visibility";
import { messageBadges } from "../../domain/chat/thread-badges";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ChatMessageRow, ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";

/** 契约派生，绝不另写一份。 */
export type GetThreadResult = z.infer<typeof C.operations.getThread.out>;

/** 不可见 —— **与「不存在」是同一个出口**（I-3）。调用方不得区分处理。 */
export class ThreadNotVisibleError extends Error {
  constructor() {
    super("thread_not_visible");
  }
}

export interface GetThreadDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
}

export interface GetThreadInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /**
   * 🔴 #594：`null` = 走个人线程分支（不是「未提供」的占位）。
   * 控制器把查询参数缺省时也映射成 `null`，见 `chat.controller.ts` 的 `thread()`。
   */
  readonly projectId: string | null;
  readonly threadId: string;
}

export async function getThread(
  deps: GetThreadDeps,
  input: GetThreadInput,
): Promise<GetThreadResult> {
  const outcome = await resolveVisibility(deps, input);
  // 两种情况一个出口。写成两个错误类型，早晚会有一处把它们映射成两个状态码。
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const { thread, actor } = outcome;
  // 正文经**同一个门**取出（F02 守卫读路径）。`decision` 是刚刚那次判定的结果——
  // 不是新造一个 `allowed: true`：那样就是绕过自己的门。
  const guarded = await deps.chat.findMessages(input.orgId, input.threadId);
  if (guarded === null) throw new ThreadNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  // allowed 已在上面判过，这里到不了；留着是因为 `discloseDecided` 是共用门，
  // 将来可能有调用方交进来一个拒绝的决定。
  if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();
  const all = disclosed.payload;

  // ⭐ 这一行就是「服务端不下发」。删掉它，观察者降级的断言必须变红。
  const visible = all.filter((m) =>
    actor.projectRole === "observer" ? observerMayReadMessage(m, thread) : true,
  );

  const meta = await deps.chat.findThreadPresentation(input.orgId, input.threadId);
  // 判定到取数之间线程被删了。仍然走同一个出口——「刚刚还在」不是一个对外可见的状态。
  if (meta === null) throw new ThreadNotVisibleError();

  return {
    thread: {
      id: thread.threadId,
      projectId: thread.projectId,
      groupId: thread.groupId,
      visibilityScope: thread.visibilityScope,
      phase: meta.phase,
      archived: thread.archived,
      createdBy: thread.createdBy,
      lastActivityAt: meta.lastActivityAt,
      version: meta.version,
    },
    // 逐字段构造，不 spread 数据库行：spread 会让「某天有人给 SELECT 加了一列」
    // 变成「响应里多了一个没人决定要公开的字段」（F03 personal-layer-summary 同理）。
    messages: visible.map(toMessage),
    rightTabs: rightTabs(visible),
    // 🔴 #594：个人线程（`thread.projectId === null`）不经 `capabilitiesFor`——
    // 它按 `ProjectRole` 分派，个人线程的 `actor.projectRole` 恒为 `null`，
    // 传进去只会拿到 `[]`（`capabilitiesFor(null)` 的既有语义是「无角色 = 无能力」，
    // 这里的 `null` 却是「这个维度不适用」，两种 `null` 不该共用一个分支）。
    // 能走到这一行说明 `resolveVisibility` 已经判过创建者身份，见 `resolvePersonalVisibility`。
    capabilities: thread.projectId === null
      ? [...PERSONAL_THREAD_CAPABILITIES]
      : capabilitiesFor(actor.projectRole),
  };
}

function toMessage(row: ChatMessageRow): z.infer<typeof C.Message> {
  return {
    id: row.id,
    authorKind: row.authorKind,
    agentId: row.agentId,
    skill: null,
    thinkingSummary: null,
    // ⭐ I-13：与线程卡的「N 条待复核」**同一个函数**。这里若写成 `[]` 或就地判一次
    //   `row.reviewPending`，两处数值就变成「碰巧相等」，而碰巧会在下一次改动时结束。
    badges: messageBadges(row),
    citations: [],
    toolCallSummary: null,
    // 转录卡 / 产物卡的可读内容。见文件头「契约缺口」：正文目前只能经由它出现。
    card: row.body,
  };
}

/**
 * 右栏恒五个标签，计数等于各自列表长度（I-20）。
 *
 * ⚠ 观察者那边的 `transcript` 计数是**真实的 0**（它一条转写都拿不到），
 *   不是把非零的数字擦成 0。两者在响应上一样，在含义上相反：后者是伪装，
 *   而伪装出来的 0 会让「计数与列表长度一致」这条不变量变成一句空话。
 */
function rightTabs(visible: readonly ChatMessageRow[]): GetThreadResult["rightTabs"] {
  const transcript = visible.filter((m) => m.rawTranscript).length;
  const counts: Record<z.infer<typeof C.RightTab>, number> = {
    transcript,
    execution: 0,
    insight: 0,
    artifact: 0,
    material: 0,
  };
  // 标签**不隐藏**，计数为 0 也在（V14）。所以是遍历枚举，不是遍历有数据的那些。
  return C.RightTab.options.map((tab) => ({ tab, count: counts[tab], failed: false }));
}
