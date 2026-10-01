/**
 * issue #4302 —— 大脑页（/brain）上的两个写动作。人类决定（2026-09-26）：复用对话里的既有动作，不加新的后端语义。
 *
 * - 「撤销取代」：`replaced.undo` 给出的那个对话（说出改口的、查看者本人的个人对话）上 `applyHumanAction{undoSupersede}`——
 *   与对话里那一行「已用〈新〉取代〈旧〉 · 撤销」是同一个动作（#4290）。
 * - 「忘掉这条」：按 `forgetPlan`（lib/brain-view.ts）逐个来源执行：`undoAutoPersonalCopy`（#4283）或来源对话上的
 *   `applyHumanAction{revokeClaim}`（F10 / F07 级联）。
 *
 * 在对话上做的动作要带那个对话的最新版本号（乐观并发）：动作前现读一次 `getThreadKnowledge`，大脑页本身不持有它。
 */
import type { KgPersonalReplacedClaim } from "@repo/contracts/chat-knowledge-graph";
import type { ForgetStep } from "@/lib/brain-view";
import { applyHumanAction, fetchThreadKnowledge, undoAutoPersonalCopy } from "@/lib/knowledge-graph-api";

async function actOnThread(threadId: string, action: Parameters<typeof applyHumanAction>[2]): Promise<void> {
  const { revision } = await fetchThreadKnowledge(threadId);
  await applyHumanAction(threadId, revision, action);
}

/** 撤销一次改口取代：旧记忆恢复为生效，新的那条仍在。 */
export async function undoSupersedeFromBrain(undo: NonNullable<KgPersonalReplacedClaim["undo"]>): Promise<void> {
  await actOnThread(undo.threadId, { type: "undoSupersede", noticeId: undo.noticeId });
}

/**
 * 忘掉一条长期记忆：逐个来源执行（一般只有一个来源）。返回已完成的步数——中途失败时调用方据此判断
 * 服务端是否已经部分变了（> 0 ⇒ 刷新列表看真实结果）。
 */
export async function forgetFromBrain(steps: readonly ForgetStep[], done: (n: number) => void = () => {}): Promise<void> {
  let n = 0;
  for (const s of steps) {
    if (s.kind === "undoAutoCopy") await undoAutoPersonalCopy(s.threadId, s.sourceClaimId);
    else await actOnThread(s.threadId, { type: "revokeClaim", claimId: s.sourceClaimId });
    n += 1;
    done(n);
  }
}
