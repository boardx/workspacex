/**
 * Phase 18 F17 —— 对「记住 / 忘掉」确认卡做决定（uc-18-6 A2 / B2，契约 actOnMemoryCard，UC-KG-12）。
 *
 * 顺序：执行身份是人（I-15 / I-17：Agent ⇒ KG_ACTOR_NOT_HUMAN，第一行就拒，什么都不读）
 *   → 卡在哪个会话（只回路由事实）→ 会话可见（看不见 = 卡不存在，不泄露别人会话里有没有这张卡）
 *   → 是会话所有者（E1 → KG_NOT_OWNER）→ 交数据库执行（所有者、actor、卡片状态、条目有没有变，数据库再判一遍）。
 * 动作结果与面板里手工操作一致（R6）：remember = 以本人身份确认 + 记到个人空间（F11 同一个 kg_promote_claim），
 * forget = 逐条失效（F07 级联收掉边与 L1 副本）。
 */
import type { OrgId } from "../../domain/org-id";
import { KgReadError, visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";
import { KgHumanActionError, type MemoryCardData, type MemoryCardPort } from "./ports";

export interface MemoryCardDeps extends KnowledgeReadDeps {
  readonly cards: MemoryCardPort;
  readonly newId: (prefix: "act") => string;
}

export async function actOnMemoryCard(
  deps: MemoryCardDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    /** 调用方身份的种类：接口层只有人类会话能到这里（恒为 human）；其余入口一律 agent。 */
    readonly actorKind: "human" | "agent";
    readonly cardId: string;
    readonly decision: "accept" | "dismiss";
    readonly claimIds?: readonly string[];
    readonly editedStatement?: string;
  },
): Promise<{ readonly card: MemoryCardData; readonly actionIds: readonly string[] }> {
  if (input.actorKind !== "human") throw new KgHumanActionError("KG_ACTOR_NOT_HUMAN");
  if (input.claimIds !== undefined && input.claimIds.length === 0) throw new KgHumanActionError("KG_INVALID_REQUEST");
  if (input.editedStatement !== undefined && input.editedStatement.trim() === "") throw new KgHumanActionError("KG_INVALID_REQUEST");
  const threadId = await deps.cards.cardThread(input.orgId, input.userId, input.cardId);
  if (threadId === null) throw new KgHumanActionError("KG_CARD_NOT_FOUND");
  let owner: string;
  try {
    owner = (await visibleThread(deps, input, threadId)).facts.createdBy;
  } catch (e) {
    if (e instanceof KgReadError) throw new KgHumanActionError("KG_CARD_NOT_FOUND");
    throw e;
  }
  if (owner !== input.userId) throw new KgHumanActionError("KG_NOT_OWNER");
  return deps.cards.act(input.orgId, input.userId, {
    actionId: deps.newId("act"), cardId: input.cardId, decision: input.decision, actorKind: input.actorKind,
    ...(input.claimIds !== undefined ? { claimIds: input.claimIds } : {}),
    ...(input.editedStatement !== undefined ? { editedStatement: input.editedStatement.trim() } : {}),
  });
}
