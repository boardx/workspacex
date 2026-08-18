import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import { observerMayReadMessage } from "../../domain/chat/thread-visibility";
import type { ResolveVisibilityDeps } from "./resolve-visibility";
import { resolveVisibility } from "./resolve-visibility";
import type {
  AcceptedHumanMessage, ChatMessageCommandRepository, MessagePageRow, PublishedAgentReader,
  PublishedAgentSnapshot, ThreadMountedSkillReader,
} from "./message-command-ports";
import { AttachmentNotPendingError } from "./message-command-ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";

export class MessageThreadNotVisibleError extends Error {}
export class MessageNoWriteRoleError extends Error {}
export class MessageThreadArchivedError extends Error {}
export class AgentNotPublishedError extends Error {}
export class MessageIdempotencyConflictError extends Error {}
export class InvalidMessageCursorError extends Error {}
/** #946 · V9-a F151：attachmentIds 有不属本线程/已挂过/不存在的 id。→ 控制器 422。 */
export class MessageAttachmentNotPendingError extends Error {}

interface Deps extends ResolveVisibilityDeps {
  readonly commands: ChatMessageCommandRepository;
  readonly publishedAgents: PublishedAgentReader;
  /**
   * #1559 —— 线程级临时挂载（F65）进入 run 快照的读口。
   *
   * ⚠ **必填，不是可选**。本仓给「既有合成点不必都改」的横切依赖开过可选的口子
   *   （`execute-run.ts` 的 `files` / `contextSnapshots` / `toolTrace`），这一条
   *   刻意不走那条路：可选意味着「某个合成点忘了注入 ⇒ 挂载静默不生效」，
   *   而那**逐字就是 #1559 本身**（挂载被记录、被展示、从不进入任何一次 run，
   *   全仓没有一条测试会红）。做成必填，漏注入的合成点连编译都过不去。
   */
  readonly threadMounts: ThreadMountedSkillReader;
}

/**
 * #1559 —— run 要跑的 skill 版本 ＝ **agent 版本自带 ∪ 本线程当前生效的临时挂载**。
 *
 * · **并集，不是覆盖**：UC-3.3 是「会话内临时**加减**」，`unmountSkillFromThread`
 *   只撤销自己加过的那一条（打 `removedAt`），从来不减 agent 自带的。覆盖语义会让
 *   「临时加一个 skill」顺带把 agent 的全部能力摘掉。
 * · **去重，先出现的留在原位**：同一个版本既被 agent 钉过、又被人挂了一次时，不去重
 *   会让同一份 `SKILL.md` 正文在 system prompt 里出现两遍（`buildSystemPrompt` 按快照
 *   顺序逐条拼，它不去重，那是刻意的：顺序与重复都是快照说了算）。去重放在这里，
 *   因为「并集」本来就是集合语义；放到 `buildSystemPrompt` 里去重则会连带把
 *   agent 版本自己钉重了的情况一起改掉，那是另一件事。
 * · **顺序：agent 自带在前、线程挂载追加在后**。ordering 是 `skillVersionIds` 的
 *   语义属性（`execute-run.ts` 的 `buildSystemPrompt` 头注：按快照顺序拼 system
 *   prompt，排序/去重/按库序回读都会悄悄丢掉被钉住的一部分）。临时挂载是「在既有
 *   能力之后再加一条」，所以追加在后。
 * · **快照进 run，不在执行时实时读**：D-30「引用必须指向不可变快照」。挂载行本身
 *   已经钉死了 `version_id`（迁移 `20260805170000` :27-29），这里只是把「这次 run
 *   当时挂了哪些」同样钉进 `agent_runs`——否则一次在途 run 会被中途的挂载/摘除改掉，
 *   而事后没有任何记录说得清它到底跑了什么。
 *
 * ⚠ 导出**只为单元测试**（`tests/chat/thread-mount-run-snapshot-union.test.ts`）。
 *   上面四条语义（并集/去重/顺序/快照）是这个 feature 的全部内容，而端到端那条
 *   反证跑的夹具里 agent 自带 skill 恰好为空 —— 顺序与去重两条在那条链上**证不到**。
 *   把它们留给「读代码看得出来」正是本仓反复出事的形状，所以单独钉住。
 */
export function withThreadMounts(
  snapshot: PublishedAgentSnapshot,
  mountedVersionIds: readonly string[],
): PublishedAgentSnapshot {
  return {
    ...snapshot,
    skillVersionIds: [...new Set([...snapshot.skillVersionIds, ...mountedVersionIds])],
  };
}

async function authorize(deps: Deps, input: { userId: string; orgId: OrgId; threadId: string }) {
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (facts === null) throw new MessageThreadNotVisibleError();
  const outcome = await resolveVisibility(deps, { ...input, projectId: facts.projectId });
  if (outcome.kind !== "allow") throw new MessageThreadNotVisibleError();
  return outcome;
}

function samePayload(
  accepted: AcceptedHumanMessage,
  input: { text: string; selectedAgentId: string },
): boolean {
  return accepted.text === input.text && accepted.requestedAgentId === input.selectedAgentId;
}

export async function acceptHumanMessage(
  deps: Deps,
  input: {
    userId: string; orgId: OrgId; threadId: string; clientMessageId: string;
    text: string; agentId: string;
    /** #946 · V9-a F151：挂到本消息的已上传 pending 附件 id（可选）。 */
    attachmentIds?: readonly string[];
  },
): Promise<AcceptedHumanMessage> {
  const visibility = await authorize(deps, input);
  if (visibility.actor.projectRole === "observer") throw new MessageNoWriteRoleError();
  if (visibility.thread.archived) throw new MessageThreadArchivedError();

  const key = {
    projectId: visibility.thread.projectId, threadId: input.threadId,
    actorId: input.userId, clientMessageId: input.clientMessageId,
  };
  const guardedExisting = await deps.commands.findAccepted(input.orgId, key);
  const disclosedExisting = discloseDecided(guardedExisting, visibility.base);
  if (!isDisclosed(disclosedExisting)) throw new MessageThreadNotVisibleError();
  const existing = disclosedExisting.payload;
  if (existing) {
    if (!samePayload(existing, { text: input.text, selectedAgentId: input.agentId })) {
      throw new MessageIdempotencyConflictError();
    }
    return existing;
  }

  const agentSnapshot = await deps.publishedAgents.resolvePublished(input.orgId, input.agentId);
  if (agentSnapshot === null) throw new AgentNotPublishedError();
  // #1559：挂载读在**判权之后、写 run 之前**——判权已在上面 `authorize` 做完，
  // 这里读的是同一条线程的挂载，不构成第二条取数越权面。
  const guardedMounts = await deps.threadMounts.activeMountedSkillVersionIds(input.orgId, {
    projectId: visibility.thread.projectId, threadId: input.threadId,
  });
  const disclosedMounts = discloseDecided(guardedMounts, visibility.base);
  if (!isDisclosed(disclosedMounts)) throw new MessageThreadNotVisibleError();
  const snapshot = withThreadMounts(agentSnapshot, disclosedMounts.payload);
  // 去重后传给仓储：仓储在同一事务内 set message_id，更新数须等于去重后数量，否则回滚。
  const attachmentIds = input.attachmentIds && input.attachmentIds.length > 0
    ? [...new Set(input.attachmentIds)]
    : undefined;
  let guardedOutcome;
  try {
    guardedOutcome = await deps.commands.accept(input.orgId, {
      ...key,
      text: input.text,
      selectedAgentId: input.agentId,
      messageId: randomUUID(),
      runId: randomUUID(),
      snapshot,
      attachmentIds,
    });
  } catch (e) {
    // 仓储在事务内因附件不合格回滚——整条消息未写入。转成用例错误交控制器映射 422。
    if (e instanceof AttachmentNotPendingError) throw new MessageAttachmentNotPendingError();
    throw e;
  }
  const disclosedOutcome = discloseDecided(guardedOutcome, visibility.base);
  if (!isDisclosed(disclosedOutcome)) throw new MessageThreadNotVisibleError();
  const outcome = disclosedOutcome.payload;
  if (outcome.kind === "conflict") throw new MessageIdempotencyConflictError();
  return outcome.accepted;
}

function encodeCursor(row: MessagePageRow): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id]), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): { createdAt: string; messageId: string } | null {
  if (value === undefined || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 ||
        typeof parsed[0] !== "string" || Number.isNaN(Date.parse(parsed[0])) ||
        typeof parsed[1] !== "string" || parsed[1] === "") {
      throw new Error("invalid");
    }
    return { createdAt: new Date(parsed[0]).toISOString(), messageId: parsed[1] };
  } catch {
    throw new InvalidMessageCursorError();
  }
}

export async function listMessagePage(
  deps: Deps,
  input: { userId: string; orgId: OrgId; threadId: string; cursor?: string; limit?: number },
) {
  const visibility = await authorize(deps, input);
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const guardedPage = await deps.commands.page(input.orgId, {
    projectId: visibility.thread.projectId, threadId: input.threadId,
    after: decodeCursor(input.cursor), limit,
  });
  const disclosedPage = discloseDecided(guardedPage, visibility.base);
  if (!isDisclosed(disclosedPage)) throw new MessageThreadNotVisibleError();
  const page = disclosedPage.payload;
  const rows = visibility.actor.projectRole === "observer"
    ? page.rows.filter((row) => observerMayReadMessage({
      id: row.id, rawTranscript: row.rawTranscript,
      visibilityScope: row.visibilityScope as typeof visibility.thread.visibilityScope | null,
    }, visibility.thread))
    : page.rows;
  // #946 · V9-a F151：附件投影。只按**可见的** rows 的 id 回读（观察者被过滤掉的消息不查其
  // 附件），一次批量查询避免 N+1。无附件的消息不带 attachments 字段（契约里可选）。
  const attachments = await deps.commands.attachmentsByMessage(input.orgId, rows.map((r) => r.id));
  return {
    messages: rows.map((row) => {
      const atts = attachments.get(row.id);
      return {
        id: row.id,
        authorKind: row.authorKind,
        authorId: row.authorId,
        agentId: row.agentId,
        text: row.text,
        clientMessageId: row.clientMessageId,
        agentRunId: row.agentRunId,
        replyToMessageId: row.replyToMessageId,
        createdAt: row.createdAt,
        ...(atts && atts.length > 0 ? { attachments: atts } : {}),
      };
    }),
    nextCursor: page.hasMore && page.rows.length > 0 ? encodeCursor(page.rows.at(-1)!) : null,
  };
}
