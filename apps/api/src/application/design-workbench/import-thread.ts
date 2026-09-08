/**
 * `importThread`（迭代 13，design-delta `design-chat-inputs` §2）—— 把一个**已有对话线程**
 * 这一刻的内容抽成摘要，作为这个设计项目的背景。
 *
 * ## 一次性导入，不是持续订阅（delta §2.1 取舍 ③=A）
 *
 * 这里没有任何"挂靠"状态：读一次、摘一段、写进 `problem`，然后就结束了。线程后来又聊了
 * 二十条，这个项目的 `problem` 一个字不变。反过来的做法（项目长期挂靠线程、每轮实时读）
 * 会让「这个设计是照什么做的」变成一个会变的东西——而设计评审要的恰恰是一个**定住的**
 * 输入，且事后拿不出「当时导进来的是什么」这份证据。
 *
 * ## 两个阶段，一条操作（`problem` 给不给）
 *
 *   · 不给 `problem` ⇒ **预览**：判权、读线程、调模型摘要，把 `summary` 交给前端渲染成
 *     可编辑的预览框。**项目一个字不写**——直接写会覆盖用户已经写好的 `problem`（V58）。
 *   · 给了 `problem` ⇒ **确认**：把这段（用户编辑之后的）文本写进项目，并在 `chat` 里追加
 *     一条 `source: "system"` 的留痕。这一阶段**不调模型**：重新摘要一遍会把用户在预览里
 *     的修改冲掉，而那正是两个阶段存在的理由。
 *
 * ⚠ 确认阶段照样重新判权、重新读线程：`title` / `messageCount` 是要写进留痕的**事实**，
 *   信前端传上来的那一份，等于让留痕可以被伪造。
 *
 * ## 线程读走的是 `getThread` 的同一条守卫读路径
 *
 * `resolveVisibility` → `chat.findMessages` → `discloseDecided`——与 `get-thread.ts` 文件头
 * 描述的、`recommend-canvas-templates.ts` 已经复用过的**同一条**路径，不新开一条直接查库的
 * 读（V56 的反证就是这条：绕过它直接查库 ⇒ 「导入别人的线程被拒」当场红）。
 *
 * ⚠ 线程的 `projectId` 由 `findThreadFacts` **从库里读出来**，不由调用方给——同
 *   `expandToolCallChain` 用 `findMessageLocation` 起手的理由。契约入参只有 `threadId`
 *   （前端选线程时手上只有它），而 `resolveVisibility` 的 `projectId` 是**判定分支选择器**
 *   （`null` = 走个人线程分支）：让调用方选分支，等于给项目线程开一条绕过项目 ACL 的捷径。
 *
 * ⚠ 线程不可见与线程不存在是**同一个出口**（`ThreadNotVisibleError` → 404，chat 束 I-3）。
 *   不映射成设计工作台自己的错误码，也不在任何地方带上标题——拒绝不许泄露存在性。
 */
import { designWorkbench as C } from "@repo/contracts";
import type { ModelCallPort } from "../agent-run/ports";
import type { FeedbackStructureModelConfig } from "../feedback/structure-feedback-draft";
import { ThreadNotVisibleError } from "../chat/get-thread";
import type { ChatMessageRow, ChatRepository } from "../chat/ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  loadProjectView,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";

/**
 * 摘要没做出来（模型没配 / 调用失败 / 输出为空）。→ 503 `DEPENDENCY_UNAVAILABLE`
 * （delta §8「导入线程失败复用 `DEPENDENCY_UNAVAILABLE`」，不新增错误码）。
 *
 * ⚠ 这里**不做兜底摘要**，与 `intake-questions.ts` 的固定问卷兜底是两回事：那边兜底的是
 *   「问什么」，问得笼统一点仍然可用；这边兜底只能是把原始对话整段塞进 `problem`，那不是
 *   摘要，是把用户本来就嫌长的东西原样倒进背景框——他要的正是别自己复制粘贴。
 *   老实报失败，让他重试或者自己写，比给他一坨他还得再删一遍的东西诚实。
 */
export class DesignThreadSummaryUnavailableError extends Error {}

export interface ImportThreadDeps extends DesignProjectDeps, ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  /**
   * 与 `intake-questions.ts` / `design-chat-model.ts` **同一个**标准补全模型端口与同一份
   * `FEEDBACK_STRUCTURE_MODEL_CONFIG`（controller 注入）。摘要是同类元任务，不新配一套。
   */
  readonly model: ModelCallPort;
  readonly chatModel: FeedbackStructureModelConfig;
  readonly log: (message: string, fields: Record<string, unknown>) => void;
}

export interface ImportThreadInput {
  readonly projectId: string;
  readonly ownerId: string;
  readonly threadId: string;
  /** 见文件头「两个阶段」：省略 = 预览（不写）；给出 = 确认写入这段文本。 */
  readonly problem?: string;
}

export interface ImportThreadResult {
  readonly project: DesignProjectView;
  readonly imported: C.ImportedThread;
  readonly summary: string;
  readonly truncated: boolean;
}

const SYSTEM_PROMPT =
  "你在帮一个产品设计师把一段已有的对话，整理成他新建设计项目时要填的「背景」。" +
  "只输出这段背景本身，不要开场白、不要小标题、不要 Markdown 列表符号以外的排版。" +
  "写成一段人话，说清四件事：谁会用、要解决什么、主线任务是什么、有哪些明确的约束或不做的事。" +
  "只写对话里**真的出现过**的内容——没聊到的维度就略过，不要替他编。" +
  "用中文，不超过 600 字。";

/** 一条消息喂给模型时的行首标记。角色只分「人」与「AI」，与 `authorKind` 一一对应。 */
function transcriptOf(messages: readonly ChatMessageRow[]): string {
  return messages.map((m) => `${m.authorKind === "human" ? "用户" : "AI"}：${m.body}`).join("\n");
}

/**
 * 判权 + 读正文 + 读标题。预览与确认两条路都从这里起步——**确认阶段不许跳过它**
 * （见文件头：留痕里的 title/messageCount 必须是服务端自己读到的事实）。
 */
async function readThread(
  deps: ImportThreadDeps,
  input: { readonly userId: string; readonly threadId: string },
): Promise<{ readonly title: string; readonly messages: readonly ChatMessageRow[]; readonly truncated: boolean }> {
  // 线程挂在哪个项目上由库回答，不由调用方给——见文件头第二条 ⚠。
  const facts = await deps.chat.findThreadFacts(deps.orgId, input.threadId);
  if (facts === null) throw new ThreadNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: deps.orgId,
    projectId: facts.projectId,
    threadId: input.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const guarded = await deps.chat.findMessages(deps.orgId, input.threadId);
  if (guarded === null) throw new ThreadNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();

  const meta = await deps.chat.findThreadPresentation(deps.orgId, input.threadId);
  // 判定到取数之间线程被删了：同一个出口。「刚刚还在」不是一个对外可见的状态（同 `getThread`）。
  if (meta === null) throw new ThreadNotVisibleError();

  const all = disclosed.payload;
  const truncated = all.length > C.IMPORT_THREAD_MAX_MESSAGES;
  // 截断取**最近** N 条：一条聊了很久的线程里，前面那些早已被后面推翻的需求会把摘要带偏。
  return { title: meta.title, messages: truncated ? all.slice(-C.IMPORT_THREAD_MAX_MESSAGES) : all, truncated };
}

/** 留痕文案。**在同一处**声明，api 写它、前端只渲染 `chat` 里的字符串，不各拼一份。 */
export function importTraceText(imported: C.ImportedThread, truncated: boolean): string {
  return (
    `从线程《${imported.title}》导入了 ${imported.messageCount} 条消息作为背景。` +
    (truncated ? `（线程更长，只读了最近 ${C.IMPORT_THREAD_MAX_MESSAGES} 条）` : "")
  );
}

export async function importThread(
  deps: ImportThreadDeps,
  input: ImportThreadInput,
): Promise<ImportThreadResult> {
  // owner 门在最前面：不是 owner 就不该因为这次调用去读任何线程，更不该写。
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  const { title, messages, truncated } = await readThread(deps, {
    userId: input.ownerId,
    threadId: input.threadId,
  });
  const imported: C.ImportedThread = {
    threadId: input.threadId,
    title,
    messageCount: messages.length,
    at: new Date().toISOString(),
  };

  if (input.problem === undefined) {
    // ── 预览：摘要一段交回去给用户改。**不写任何东西**（V58）。 ──
    const summary = await summarize(deps, messages);
    return { project: await loadProjectView(deps, input.projectId), imported, summary, truncated };
  }

  // ── 确认：写用户编辑之后的那段文本 + 留痕。两次仓储调用，顺序同 `appendProjectChat`：
  //    先写字段、后追加留痕。反过来失败 ⇒ 对话里写着「已导入」而背景没变，那是对用户撒谎。
  const updated = await deps.projects.update(input.projectId, input.ownerId, { problem: input.problem });
  if (updated === null) throw new DesignProjectNotOwnerError();
  const traced = await deps.projects.appendChat(input.projectId, input.ownerId, [
    { role: "ai", text: importTraceText(imported, truncated), source: "system" },
  ]);
  if (traced === null) throw new DesignProjectNotOwnerError();

  return {
    project: await loadProjectView(deps, input.projectId),
    imported,
    summary: input.problem,
    truncated,
  };
}

async function summarize(deps: ImportThreadDeps, messages: readonly ChatMessageRow[]): Promise<string> {
  if (messages.length === 0) throw new DesignThreadSummaryUnavailableError();
  let text: string;
  try {
    const completion = await deps.model.complete({
      modelProvider: deps.chatModel.provider,
      modelId: deps.chatModel.modelId,
      system: SYSTEM_PROMPT,
      user: `对话内容：\n${transcriptOf(messages)}`,
    });
    text = completion.text.trim();
  } catch (e) {
    deps.log("import-thread: model call failed", { detail: e instanceof Error ? e.message : "unknown" });
    throw new DesignThreadSummaryUnavailableError();
  }
  // 空输出与调用失败对用户是同一件事：这次没摘出来。不把空串当成"摘要就是空的"写进预览框。
  if (text === "") {
    deps.log("import-thread: model returned empty summary", { messages: messages.length });
    throw new DesignThreadSummaryUnavailableError();
  }
  return text.slice(0, 4000);
}
