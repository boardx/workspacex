/**
 * `listThreads` —— 今天/本周分组的线程卡列表（F109 · uc-8-1 UC-4）。
 *
 * ## 过滤发生在服务端，而且是**同一个**服务端过滤
 *
 * 每条候选线程都经 `resolveVisibility`——与 `getThread` 逐字同一个函数。这不是
 * 「也调用了一下判权」：列表如果在 SQL 里写一句自己的可见性 WHERE，本束就有了
 * 两份可见性实现，而 I-12 / X-5 反复讲的就是「文件浏览器不是权限旁路」，
 * 列表同理。代价是 N 次判定查询，收益是**不可能**与详情给出不同的答案。
 *
 * ## ⚠ 反证记录（2026-07-31）：这里有**两道**门，下面那一行不是唯一控制点
 *
 * 把 `if (outcome.kind !== "allow") continue;` 改成 `if (false) continue;`，
 * 「别组线程不在响应载荷里」那条断言**没有变红**——因为 `buildCard` 里的守卫读路径
 * （`discloseDecided(guarded, outcome.base)`，F02）拿着一个 `allowed: false` 的决定
 * 解不开 `Guarded`，于是卡片仍然被丢掉。
 *
 * 把两道一起拆掉（额外把交给 `discloseDecided` 的决定伪造成 `allowed: true`），
 * 断言当场变红，响应里出现了 `t-g2`。⇒ 断言**有能力**抓住真正的泄露，不是空转；
 * 但读这段代码的人不要以为改了下面那一行就改变了行为——真正的控制点是**两处**，
 * 而它们各自都足以挡住。（同一种记法见 `thread-visibility.ts` 的 `MEMBER_PRIVATE_READERS`。）
 *
 * 断言查的是**响应体的 JSON**，不是界面渲染了什么——前端不渲染的东西已经过网了。
 *
 * ## 徽标不在这里算
 *
 * 见 `domain/chat/thread-badges.ts`。本文件只做三件事：判权、取事实、调那一个函数。
 *
 * ## 计数只数**可见**的消息
 *
 * `reviewPending` 数的是观察者投影**之后**剩下的消息。数全部消息会让徽标变成一个
 * 侧信道：一个看不到私聊消息的人，能从「3 条待复核」里读出那里有三条他读不到的东西。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { observerMayReadMessage } from "../../domain/chat/thread-visibility";
import {
  threadAgentSummary,
  threadBadgeState,
  toContractBadges,
} from "../../domain/chat/thread-badges";
import { THREAD_GROUP_ORDER, threadGroupLabel } from "../../domain/chat/thread-grouping";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { Clock } from "../auth/ports";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";

export type ListThreadsResult = z.infer<typeof C.operations.listThreads.out>;
type ThreadCard = z.infer<typeof C.ThreadCard>;

export interface ListThreadsDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly clock: Clock;
}

export interface ListThreadsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly filter?: "all" | "project" | "my-agents";
  readonly includeArchived?: boolean;
}

export async function listThreads(
  deps: ListThreadsDeps,
  input: ListThreadsInput,
): Promise<ListThreadsResult> {
  const includeArchived = input.includeArchived === true;
  const candidates = await deps.chat.listProjectThreads(input.orgId, input.projectId, {
    includeArchived,
  });

  const now = deps.clock.now();
  const byLabel = new Map<string, ThreadCard[]>();

  for (const row of candidates) {
    // 分组先算：本周之前的线程没有可归的组（待裁决第 11 条），
    // 那就没必要为它跑一次判权。⚠ 顺序反过来也正确，只是慢。
    const label = threadGroupLabel(new Date(row.lastActivityAt), now);
    if (label === null) continue;

    const outcome = await resolveVisibility(deps, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      threadId: row.threadId,
    });
    // 不可见与不存在在这里是同一件事：都不进列表，也**不进任何计数**。
    // 返回「还有 N 条你看不到」就是 uc-8-5 V9 禁止的那种泄露。
    if (outcome.kind !== "allow") continue;

    const card = await buildCard(deps, input.orgId, row, outcome);
    if (card === null) continue;
    const bucket = byLabel.get(label) ?? [];
    bucket.push(card);
    byLabel.set(label, bucket);
  }

  // 空态：**`groups: []`**，不生成示例线程（契约 `listThreads` 注释 / V4）。
  if (byLabel.size === 0) return { groups: [] };

  // 组标题常驻（R8）：有内容时两组都在，空组也在——否则「今天没有对话」会与
  // 「今天这一组没被实现」在界面上无法区分。
  return {
    groups: THREAD_GROUP_ORDER.map((label) => ({
      label,
      cards: (byLabel.get(label) ?? []).sort((a, b) =>
        a.lastActivityAt < b.lastActivityAt ? 1 : -1,
      ),
    })),
  };
}

async function buildCard(
  deps: ListThreadsDeps,
  orgId: OrgId,
  row: Awaited<ReturnType<ChatRepository["listProjectThreads"]>>[number],
  outcome: Extract<Awaited<ReturnType<typeof resolveVisibility>>, { kind: "allow" }>,
): Promise<ThreadCard | null> {
  // 正文经守卫读路径取出，交的是**刚刚那次判定**——不是现造一个 allow。
  const guarded = await deps.chat.findMessages(orgId, row.threadId);
  if (guarded === null) return null;
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) return null;

  // ⭐ 与 `getThread` 逐字同一条过滤（`observerMayReadMessage`）。
  //   计数因此只覆盖这个人真的读得到的消息——见文件头「计数只数可见的消息」。
  const visible = disclosed.payload.filter((m) =>
    outcome.actor.projectRole === "observer" ? observerMayReadMessage(m, row) : true,
  );

  const speakingAgentIds = row.agentPrivate
    ? [] // O-24：私聊不计入 `N 个 agent`。
    : await deps.chat.findSpeakingAgentIds(orgId, row.threadId);

  const state = threadBadgeState({
    messages: visible,
    transcribing: row.transcribing,
    archived: row.archived,
    speakingAgentIds,
  });

  const lastAgent = visible.filter((m) => m.authorKind === "agent").at(-1)?.agentId ?? null;

  return {
    id: row.threadId,
    title: row.title,
    // ⚠ 契约的 `subtitle` 对应 uc-8-1 R3 的「标题（含副标题）」，**不是**状态行。
    //   把 `● 转录中` / `已归档` 塞进这里会让它变成一个没人能解析的状态字段——
    //   契约缺口原样上报，见 `thread-badges.ts` 文件头。
    subtitle: "",
    badges: toContractBadges(state),
    agentSummary: threadAgentSummary({
      state,
      agentPrivate: row.agentPrivate,
      lastAgentLabel: lastAgent,
      lastActivityLabel: row.lastActivityAt,
    }),
    lastActivityAt: row.lastActivityAt,
    visibilityScope: row.visibilityScope,
  };
}
