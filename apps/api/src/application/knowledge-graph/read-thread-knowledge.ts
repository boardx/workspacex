/**
 * Phase 18 F09 —— 读知识：本会话知识面板、结论来源抽屉、每轮回答下方的「已记下 N 条」。
 *
 * 权限只有一处判定：会话可见性（chat 的 `resolveVisibility`，与读会话消息同一个判定）。
 * 知识是从这个会话里抽出来的，能看会话 ⇔ 能看它的知识；内容经守卫读路径，交出同一个判定才拿得到。
 *
 * 「不存在」与「看不见」对外同一个出口（KG_THREAD_NOT_FOUND / KG_CLAIM_NOT_FOUND）：
 * 分开了就能用来探测别人会话 / 结论是否存在（同 chat.controller 的 ThreadNotVisibleError 处理）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { ThreadFacts } from "../../domain/chat/thread-visibility";
import { AuthzUnavailableError, resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { KnowledgeReadPort, KnowledgeThreadRef } from "./ports";

export type KgReadErrorCode = "KG_THREAD_NOT_FOUND" | "KG_CLAIM_NOT_FOUND" | "KG_NOT_VISIBLE";

export class KgReadError extends Error {
  constructor(readonly code: KgReadErrorCode) {
    super(code);
  }
}

export interface KnowledgeReadDeps extends ResolveVisibilityDeps {
  readonly knowledge: KnowledgeReadPort;
}

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

interface VisibleThread {
  readonly facts: ThreadFacts;
  readonly ref: KnowledgeThreadRef;
  readonly base: PermissionDecision;
}

export async function visibleThread(deps: KnowledgeReadDeps, viewer: Viewer, threadId: string): Promise<VisibleThread> {
  let facts: ThreadFacts | null;
  try {
    facts = await deps.chat.findThreadFacts(viewer.orgId, threadId);
  } catch {
    // 与 resolveVisibility 同一条纪律：判定依赖读不到 ⇒ 拒绝并报 503，不是 500，也不是放行。
    throw new AuthzUnavailableError();
  }
  if (facts === null) throw new KgReadError("KG_THREAD_NOT_FOUND");
  const outcome = await resolveVisibility(deps, { ...viewer, projectId: facts.projectId, threadId });
  if (outcome.kind !== "allow") throw new KgReadError("KG_THREAD_NOT_FOUND");
  return { facts, ref: { threadId, projectId: facts.projectId }, base: outcome.base };
}

function reveal<T>(guarded: Guarded<T>, base: PermissionDecision, code: KgReadErrorCode): T {
  const d = discloseDecided(guarded, base);
  if (!isDisclosed(d)) throw new KgReadError(code);
  return d.payload;
}

/** U-6：个人线程、或项目里的「仅自己」线程 ⇒ 仅你可见；其余 ⇒ 会话成员可见。 */
function visibilityOf(facts: ThreadFacts): KG.KgVisibility {
  return facts.projectId === null || facts.visibilityScope === "private" ? "owner_only" : "thread_members";
}

export async function getThreadKnowledge(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly threadId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getThreadKnowledge.out>> {
  const t = await visibleThread(deps, input, input.threadId);
  const data = reveal(await deps.knowledge.threadKnowledge(input.orgId, input.userId, t.ref), t.base, "KG_THREAD_NOT_FOUND");
  const isOwner = t.facts.createdBy === input.userId;
  return {
    scope: { kind: "chat_session", id: input.threadId },
    ...data,
    // uc-18-3 R5：只有会话所有者能编辑；其他看得到会话的成员只读。
    canEdit: isOwner,
    // uc-18-4 E2：「存入个人空间」只在个人线程出现。
    canPromote: isOwner && t.facts.projectId === null,
    visibility: visibilityOf(t.facts),
  };
}

export async function getClaimSources(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly claimId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getClaimSources.out>> {
  const route = await deps.knowledge.claimRoute(input.orgId, input.userId, input.claimId);
  if (route === null) throw new KgReadError("KG_CLAIM_NOT_FOUND");
  if (route.scopeKind === "personal") return personalClaimSources(deps, input, route.scopeId);
  if (route.scopeKind !== "chat_session") throw new KgReadError("KG_CLAIM_NOT_FOUND");
  let t: VisibleThread;
  try {
    t = await visibleThread(deps, input, route.scopeId);
  } catch (e) {
    if (e instanceof KgReadError) throw new KgReadError("KG_CLAIM_NOT_FOUND");
    throw e;
  }
  const guarded = await deps.knowledge.claimSources(input.orgId, input.userId, input.claimId, t.ref);
  if (guarded === null) throw new KgReadError("KG_CLAIM_NOT_FOUND");
  return reveal(guarded, t.base, "KG_CLAIM_NOT_FOUND");
}

/**
 * F12：个人空间（L1）结论的来源——「引用可点回会话 A 原消息」。
 * 只有本人看得到（别人的个人空间与不存在同一个出口）；证据消息逐个会话重新判可见性，
 * 只返回现在还看得到的会话里的那些（会话被删 / 被移出项目后，它的原话不再从 L1 漏出来）。
 */
async function personalClaimSources(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly claimId: string },
  ownerId: string,
): Promise<z.infer<typeof KG.knowledgeGraph.getClaimSources.out>> {
  if (ownerId !== input.userId) throw new KgReadError("KG_CLAIM_NOT_FOUND");
  const visible: VisibleThread[] = [];
  for (const threadId of await deps.knowledge.claimEvidenceThreads(input.orgId, input.userId, input.claimId)) {
    try {
      visible.push(await visibleThread(deps, input, threadId));
    } catch (e) {
      if (!(e instanceof KgReadError)) throw e;
    }
  }
  if (visible.length === 0) throw new KgReadError("KG_CLAIM_NOT_FOUND");
  // 披露判定用第一个可见会话的；其余会话已在上面逐个判过，只作为证据范围传下去。
  const guarded = await deps.knowledge.claimSources(input.orgId, input.userId, input.claimId, visible[0]!.ref, visible.map((t) => t.ref.threadId));
  if (guarded === null) throw new KgReadError("KG_CLAIM_NOT_FOUND");
  return reveal(guarded, visible[0]!.base, "KG_CLAIM_NOT_FOUND");
}

export async function getTurnMemory(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly threadId: string; readonly messageId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getTurnMemory.out>> {
  const t = await visibleThread(deps, input, input.threadId);
  return reveal(await deps.knowledge.turnMemory(input.orgId, input.userId, t.ref, input.messageId), t.base, "KG_THREAD_NOT_FOUND");
}

/** issue #4180：一条消息自己刚被抽取出的新结论——发送下方「已记下：{摘要}·撤销」。 */
export async function getMessageExtraction(
  deps: KnowledgeReadDeps,
  input: Viewer & { readonly threadId: string; readonly messageId: string },
): Promise<z.infer<typeof KG.knowledgeGraph.getMessageExtraction.out>> {
  const t = await visibleThread(deps, input, input.threadId);
  return reveal(await deps.knowledge.messageExtraction(input.orgId, input.userId, t.ref, input.messageId), t.base, "KG_THREAD_NOT_FOUND");
}
