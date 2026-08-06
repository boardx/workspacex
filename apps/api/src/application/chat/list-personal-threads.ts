/**
 * `listPersonalThreads` —— 🔴 #594：今天/本周分组的**个人**线程卡列表。
 *
 * 逐字复刻 `list-threads.ts` 的过滤纪律，只换了候选来源与判权分支：
 *   · 候选行来自 `listPersonalThreads`（新方法），不是 `listProjectThreads`；
 *   · 每条候选仍然逐条经 `resolveVisibility`（`projectId: null`，走个人分支）——
 *     不在 SQL 里写「只返回我自己的」当作可见性判断，那句 WHERE 只是性能手段，
 *     真正的「能不能看」仍由同一个函数回答（I-12 同源要求，见 `ports.ts` 头注）。
 *   · 能力集合不查任何项目角色——个人线程没有这个概念，恒为
 *     `PERSONAL_THREAD_CAPABILITIES`（同 #489 的理由：零线程时也要能建第一条）。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { PERSONAL_THREAD_CAPABILITIES } from "../../domain/chat/thread-visibility";
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

export type ListPersonalThreadsResult = ListThreadsLikeResult;
type ListThreadsLikeResult = z.infer<typeof C.operations.listThreads.out>;
type ThreadCard = z.infer<typeof C.ThreadCard>;

export interface ListPersonalThreadsDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly clock: Clock;
}

export interface ListPersonalThreadsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly includeArchived?: boolean;
}

export async function listPersonalThreads(
  deps: ListPersonalThreadsDeps,
  input: ListPersonalThreadsInput,
): Promise<ListPersonalThreadsResult> {
  const includeArchived = input.includeArchived === true;
  const candidates = await deps.chat.listPersonalThreads(input.orgId, input.userId, {
    includeArchived,
  });

  // 恒下发，不查任何东西——个人线程能不能建第一条不取决于「已经有几条」（#489 同理）。
  const capabilities = [...PERSONAL_THREAD_CAPABILITIES];

  const now = deps.clock.now();
  const byLabel = new Map<string, ThreadCard[]>();

  for (const row of candidates) {
    const label = threadGroupLabel(new Date(row.lastActivityAt), now);
    if (label === null) continue;

    const outcome = await resolveVisibility(deps, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: null,
      threadId: row.threadId,
    });
    // 不可见与不存在同一件事：不进列表、不进任何计数（uc-8-5 V9 同一条纪律）。
    if (outcome.kind !== "allow") continue;

    const card = await buildCard(deps, input.orgId, row, outcome);
    if (card === null) continue;
    const bucket = byLabel.get(label) ?? [];
    bucket.push(card);
    byLabel.set(label, bucket);
  }

  if (byLabel.size === 0) return { groups: [], capabilities };

  return {
    groups: THREAD_GROUP_ORDER.map((label) => ({
      label,
      cards: (byLabel.get(label) ?? []).sort((a, b) =>
        a.lastActivityAt < b.lastActivityAt ? 1 : -1,
      ),
    })),
    capabilities,
  };
}

async function buildCard(
  deps: ListPersonalThreadsDeps,
  orgId: OrgId,
  row: Awaited<ReturnType<ChatRepository["listPersonalThreads"]>>[number],
  outcome: Extract<Awaited<ReturnType<typeof resolveVisibility>>, { kind: "allow" }>,
): Promise<ThreadCard | null> {
  const guarded = await deps.chat.findMessages(orgId, row.threadId);
  if (guarded === null) return null;
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) return null;

  // 🔴 个人线程**不经** `observerMayReadMessage` 过滤——那个函数按设计排除
  // `private`/`member-private` 可见范围的消息（观察者看不到私聊），而个人线程的
  // `visibilityScope` 默认恰好就是 `private`（见 `createPersonalThread`）。
  // 不加这行防线，`observerMayReadMessage` 会把创建者自己的每一条消息都当成
  // 「观察者不该看的私聊」滤掉——那不是「观察者降级」，是把创建者也当观察者了。
  // 走到这里已经证明调用者就是创建者（`resolvePersonalVisibility` 的 I-3 门），
  // 个人线程没有观察者这个概念，全部可见消息直接进卡片。
  const visible = disclosed.payload;

  const speakingAgentIds = await deps.chat.findSpeakingAgentIds(orgId, row.threadId);

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
