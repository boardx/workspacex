import { randomUUID } from "node:crypto";
import { chat as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { observerMayReadMessage } from "../../domain/chat/thread-visibility";
// 🔴 #2094：自动命名。规则在 domain 层（纯函数），默认名的字面量单源于 `mutate-thread.ts`
// ——在这里再写一遍 `"新对话"` 就是「同一事实声明在两处」，而漂移那天没人会收到通知。
import { deriveThreadTitle } from "../../domain/chat/thread-title";
import { DEFAULT_PERSONAL_THREAD_TITLE } from "./mutate-thread";
// 2026-08-27：自动命名叠加模型摘要，见 `generate-thread-title.ts` 头注。
import type { GenerateThreadTitleDeps } from "./generate-thread-title";
import { generateThreadTitle } from "./generate-thread-title";
import type { ResolveVisibilityDeps } from "./resolve-visibility";
import { resolveVisibility } from "./resolve-visibility";
import type {
  AcceptedHumanMessage, ChatMessageCommandRepository, EnabledSkillVersionReader, MessagePageRow,
  PublishedAgentReader, PublishedAgentSnapshot, ThreadMountedSkillReader,
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

interface Deps extends ResolveVisibilityDeps, GenerateThreadTitleDeps {
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
  /**
   * #2514 —— agent 默认加载的「全部已启用 skill」读口。同 `threadMounts` 一样**必填**，
   * 同一条理由：可选意味着某个合成点忘了注入 ⇒ 默认加载静默不生效，而没有一条测试会红。
   */
  readonly enabledSkills: EnabledSkillVersionReader;
}

/**
 * #2514（2026-09-02 人类裁决）—— run 要跑的 skill 版本的**唯一解析规则**：
 *
 *     resolved = (agent 自带非空 ? agent 自带 : 组织全部已启用) ∪ 线程挂载
 *
 * · **默认加载**：agent 已发布版本没钉任何 skill（`skill_version_ids = '{}'`）时，
 *   run 加载组织（含平台组织）全部「已启用」skill 的当前生效版本——用户不再在
 *   composer 里挑选，agent 直接拥有全部能力。
 * · **agent 级覆盖，不是并集**：agent 钉了 skill（后台 A2 pin，`agent_versions.
 *   skill_version_ids` 非空）时，只用它钉的那些。裁决原话是「覆盖全局列表」：选了
 *   一个精心编排过的 agent，再把全局几十个 skill 一起塞进 system prompt，编排就
 *   没有意义了。
 * · **线程挂载保留为追加**（旧轨道 `/chat/legacy` 的 `ChatSkillMountPanel` 仍在用）：
 *   语义与 #1559 逐字相同——并集、去重、agent/默认在前、挂载追加在后。默认加载已把
 *   全部已启用 skill 带上时，挂载同一个 skill 是幂等的（去重吃掉）；对钉了 skill 的
 *   agent，挂载是「在编排之上临时加一个」。
 *
 * 导出**只为单元测试**（`tests/chat/agent-default-skill-loading.test.ts`）：真栈 e2e
 * 的夹具 agent 自带恒为空，「覆盖」那条在 e2e 上证不到，单独钉住。
 */
export function resolveRunSkillVersionIds(input: {
  readonly agentPinned: readonly string[];
  readonly orgEnabled: readonly string[];
  readonly mounted: readonly string[];
}): readonly string[] {
  const base = input.agentPinned.length > 0 ? input.agentPinned : input.orgEnabled;
  // 并集/去重/顺序三条语义只在 `withThreadMounts` 一处实现——这里只决定「底座是谁」。
  return withThreadMounts({ skillVersionIds: base } as PublishedAgentSnapshot, input.mounted).skillVersionIds;
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
    /**
     * 消息 + 排队 run **已落库**之后、自动命名**之前**的钩子——调用方在这里 `kick`
     * 执行器（见下方 `autoTitleFromFirstMessage` 头注「2026-09-02 更新」）。
     * 真正新受理时调用一次；幂等命中（同一 clientMessageId 重发）也会调（见下方
     * `if (existing)` 分支自己的注——第一次请求落库成功但 kick 丢失时，这是唯一能把
     * 卡住的 queued run 捞回来的路径，`kick` 本身对已在跑/已完成的 run 是 no-op）。
     * 不会调的只有「起名」那一半：起名逻辑在这个钩子之后单独跑，幂等命中直接
     * return，走不到那一步。
     */
    onAccepted?: () => void;
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
    // 2026-09-02 补（独立 review 抓到的回归）：幂等命中也要 kick。上面头注「只在真正
    // 新受理时调用」说的是"起名"那一半——起名确实只该跑一次，这里也确实没跑。但
    // `onAccepted` 现在**唯一**承载了 kick，而 `queued` run 的记录合同就是"下一条消息
    // 的 kick 会捞回来"（`ports.ts` `reclaimStaleRunning` 头注）：第一次请求落库成功但
    // `kick` 本身丢失/失败（进程死在落库和 kick 之间的那一小段），旧版本靠"调用方在
    // accept 成功后无条件 kick"兜底——这个 return 分支绕过了新版本唯一的 kick 调用点，
    // 相同 clientMessageId 的重试因此不再有机会把卡住的 queued run 捞回来。
    // kick 本身是幂等的重新触发一次 `AgentRunExecutor.tick()`（`claimQueued` 只认
    // `status='queued'` 的行，run 已经在跑或已完成时这次 tick 对它是 no-op），所以在
    // 这里也调用它不会有副作用，只会补上原本可能丢失的那一次。
    input.onAccepted?.();
    // #2693 -- stamped explicitly here, not by the repository: this `if (existing)` branch
    // IS the definition of "reused" (`acceptHumanMessage`'s idempotency guard handed back an
    // already-accepted call's run instead of creating one). See `AcceptedHumanMessage.reused`'s
    // own doc for why `agui-bridge.ts` needs this.
    return { ...existing, reused: true };
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
  // #2514：agent 没钉 skill 时才需要全局列表；钉了就是覆盖，连这条读都省掉。
  let orgEnabled: readonly string[] = [];
  if (agentSnapshot.skillVersionIds.length === 0) {
    const guardedEnabled = await deps.enabledSkills.currentEnabledSkillVersionIds(input.orgId, {
      projectId: visibility.thread.projectId, threadId: input.threadId,
    });
    const disclosedEnabled = discloseDecided(guardedEnabled, visibility.base);
    if (!isDisclosed(disclosedEnabled)) throw new MessageThreadNotVisibleError();
    orgEnabled = disclosedEnabled.payload;
  }
  const snapshot: PublishedAgentSnapshot = {
    ...agentSnapshot,
    skillVersionIds: resolveRunSkillVersionIds({
      agentPinned: agentSnapshot.skillVersionIds,
      orgEnabled,
      mounted: disclosedMounts.payload,
    }),
  };
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

  // run 已经在队列里了——先让执行器动起来，再去起名。起名最多等 THREAD_TITLE_TIMEOUT_MS，
  // 放在 kick 之前就是让模型回复白白晚这么久（见 autoTitleFromFirstMessage 头注）。
  input.onAccepted?.();

  await autoTitleFromFirstMessage(deps, {
    orgId: input.orgId,
    threadId: input.threadId,
    text: input.text,
  });

  // #2693 -- explicit `false` (not just "field omitted"): a genuinely fresh accept, mirrors
  // the `reused: true` stamped on the idempotent-hit branch above.
  return { ...outcome.accepted, reused: false };
}

/**
 * 🔴 #2094：**自动命名** —— 人类裁决落地（回指 #2068）。命名规则与「为什么截断
 * 而不是让模型生成摘要」在 `domain/chat/thread-title.ts` 的文件头，这里只讲
 * **为什么挂在这一行**。
 *
 * ## 为什么在 `acceptHumanMessage` 里，而不是别处
 *
 * 这是人类消息进入 chat 的**唯一入口**：REST 的 `POST /chat/threads/:id/messages`
 * （`chat.controller.ts`）与 CopilotKit v2 轨道的 `runAguiBridgeTurn`
 * （`agent-run/agui-bridge.ts`）都经过它。挂在这里，两条轨道自动是同一个答案；
 * 挂在任何一条轨道上，另一条就得再写一份规则——那正是本仓五次漂移的形状。
 *
 * ## 为什么在写入**之后**，且失败不回滚整条消息
 *
 * 顺序是先落消息再起名。反过来会在写入失败时留下一条顶着任务标题、却一条消息
 * 都没有的线程——那比「新对话」更难理解。
 *
 * 起名失败**不抛**：用户的消息已经落库了，为了一个标题把成功变成 500，是拿
 * 「装饰性的没做成」否定「实质性的已做成」。失败的后果是标题停在「新对话」，
 * 正是本 issue 之前的状态，不会更糟。
 *
 * ## 幂等重发不会重复起名
 *
 * 幂等命中在上面 `if (existing)` 处就 return 了，走不到这里。即便走到，
 * `autoTitleThreadIfDefault` 的 `WHERE title = $default` 也会命中 0 行。
 *
 * ## 项目线程为什么天然不受影响
 *
 * 项目线程的标题由用户在创建时必填（`normalizeTitle` 拒绝空标题），不可能等于
 * `DEFAULT_PERSONAL_THREAD_TITLE`，于是这条 UPDATE 对它们恒为 no-op。
 * 这不是加了 `if`，是条件本身就排除了它们。
 *
 * ## 2026-08-27 更新：先试模型，失败落回截断
 *
 * 见 `generate-thread-title.ts` 头注——`deriveThreadTitle` 一行没改，仍是失败/超时
 * 时唯一的落地点；这里只是多了一步"先问一次模型"。
 *
 * ## 2026-09-02 更新：起名不再挡在每条消息的回复前面
 *
 * 人类实测「最简单的消息也要等很久」，根因之一就在这一行：上面那步"先问一次模型"
 * 是**每条消息**都问（不只首条），而且是在调用方 `kick` 执行器**之前**串行等它——
 * 每条消息在模型开始回答之前先白等一次起名往返（起名模型慢/不支持时稳定吃满
 * `THREAD_TITLE_TIMEOUT_MS` = 3 秒）。结果只在首条消息有用，其余全被
 * `autoTitleThreadIfDefault` 的 `WHERE title = $默认名` 丢掉。两处修正：
 *   1. **先 kick 再起名**：`acceptHumanMessage` 在 run 落库后立刻回调 `onAccepted`
 *      （调用方在里面 kick），起名与真正的回答并行，不再串在前面。
 *   2. **标题已不是默认名就不调模型**：先查 `isThreadTitleDefault`，非首条消息一次
 *      模型往返都不发。只有首条起名这条规则仍只由那条 UPDATE 判定（见上「幂等」节）。
 * 仍然 `await` 而不是扔到后台：REST 202 返回时标题已定，不出现「先显示新对话、
 * 几秒后自己跳成模型版本」（`generate-thread-title.test.ts` ③ 的断言线）。
 */
async function autoTitleFromFirstMessage(
  deps: Deps,
  input: { readonly orgId: OrgId; readonly threadId: string; readonly text: string },
): Promise<void> {
  let stillDefault: boolean;
  try {
    stillDefault = await deps.chat.isThreadTitleDefault(
      input.orgId, input.threadId, DEFAULT_PERSONAL_THREAD_TITLE,
    );
  } catch {
    return; // 见下：消息已落库，起名链路上的任何失败都不该把请求打红。
  }
  if (!stillDefault) return;
  const modelTitle = await generateThreadTitle(deps, { firstMessageText: input.text }).catch(() => null);
  const title = modelTitle ?? deriveThreadTitle(input.text);
  // 正文全是空白 ⇒ 没有可用输入（模型也不可能凭空产出）。留着「新对话」，不编一个。
  if (title === null) return;
  try {
    await deps.chat.autoTitleThreadIfDefault(
      input.orgId,
      input.threadId,
      title,
      DEFAULT_PERSONAL_THREAD_TITLE,
    );
  } catch {
    // 见上：消息已落库，标题失败不该把整个请求打红。
  }
}

// 编码实现单源于 `packages/contracts/src/chat.ts` 的 `encodeMessageCursor`——见那份
// 头注（issue #728 D 组 round 2 H3 阻塞回归根因）：前端「软重读」追新游标与这里
// 「翻页游标」必须是逐字节相同的算法，本文件不再自己维护第二份。
const encodeCursor = C.encodeMessageCursor;

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
