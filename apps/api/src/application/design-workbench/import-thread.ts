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
// 迭代 16：与设计对话那条链路**同一个** JSON 抽取（宽松找 `{...}`），不抄第二份。
import { extractJsonObject } from "./design-chat-model";
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
  /** 迭代 16（#3773 R3）：确认阶段一并写入的验收标准（用户在预览里改过的那份）。省略 = 不动。 */
  readonly criteria?: readonly string[];
}

export interface ImportThreadResult {
  readonly project: DesignProjectView;
  readonly imported: C.ImportedThread;
  readonly summary: string;
  /** 迭代 16（#3773 R3）：同一段对话里抽出的验收标准建议；抽不到 ⇒ `[]`（不编）。 */
  readonly criteria: readonly string[];
  readonly truncated: boolean;
}

/**
 * 迭代 16（#3773 R3）—— 摘要**一次抽两件**：背景 + 验收标准。
 *
 * 原来只抽一段 600 字的背景散文。而一次产品讨论里真正难复述的恰恰是那些具体口径
 * （「导出成功率 ≥ 99%」「历史会话要能继续」）——把它们一起压进散文，等于让用户
 * 再读一遍对话把它们挑出来，而他要的正是别自己复制粘贴。
 *
 * ⚠ **抽不到就给空数组，不许编**。这条是整段提示词里最重要的一句：验收标准是后面
 *   「这个设计做完了没有」的判据，编出来的一条会一路走到排期里去。
 */
const SYSTEM_PROMPT =
  "你在帮一个产品设计师把一段已有的对话，整理成他新建设计项目时要填的「背景」与「验收标准」。" +
  "只输出一个 JSON 对象，不要解释、不要 markdown 代码块标记，形如 " +
  '{"problem":"背景正文","criteria":["验收标准，一条一句"]}。' +
  "problem 写成一段人话（不超过 600 字），说清四件事：谁会用、要解决什么、主线任务是什么、" +
  "有哪些明确的约束或不做的事。" +
  "criteria 只收对话里**真的定下来过**的可验收口径（有具体对象、能判真假的那种），一条不超过 200 字，最多 20 条；" +
  "对话里没有定下任何口径就给 `[]`——**不要替他编**，编出来的一条会一路走到排期里去。" +
  "两者都只写对话里真的出现过的内容，没聊到的维度就略过。用中文。";

/**
 * 迭代 16（#3773 R3）：截断时保留的**开头**条数。开头几条通常是需求原文，
 * 只取尾部会让摘要读完不知道这是个什么产品。
 */
export const IMPORT_HEAD_MESSAGES = 6;

/**
 * 迭代 16（#3773 R3）：截断**首尾兼顾**的纯函数（挑出来是为了能直接钉住它）。
 *
 * 不超上限 ⇒ 原样全给，`truncated: false`。超了 ⇒ 最早的 `IMPORT_HEAD_MESSAGES` 条
 * + 最近的其余条，`omittedAfter` 指出断档插在第几条之后。
 */
export function selectImportMessages(all: readonly ChatMessageRow[]): {
  readonly messages: readonly ChatMessageRow[];
  readonly truncated: boolean;
  readonly omittedAfter?: number;
} {
  if (all.length <= C.IMPORT_THREAD_MAX_MESSAGES) return { messages: all, truncated: false };
  const tail = C.IMPORT_THREAD_MAX_MESSAGES - IMPORT_HEAD_MESSAGES;
  return {
    messages: [...all.slice(0, IMPORT_HEAD_MESSAGES), ...all.slice(-tail)],
    truncated: true,
    omittedAfter: IMPORT_HEAD_MESSAGES,
  };
}

/** 一条消息喂给模型时的行首标记。角色只分「人」与「AI」，与 `authorKind` 一一对应。 */
function transcriptOf(messages: readonly ChatMessageRow[], omittedAfter?: number): string {
  const lines = messages.map((m) => `${m.authorKind === "human" ? "用户" : "AI"}：${m.body}`);
  // 断档要说出来：模型不知道中间少了东西，就会把断档两侧当成连续的一段话。
  if (omittedAfter !== undefined && omittedAfter < lines.length) {
    lines.splice(omittedAfter, 0, "（……这里省略了中间的若干条，下面是这条线程最近的部分……）");
  }
  return lines.join("\n");
}

/**
 * 判权 + 读正文 + 读标题。预览与确认两条路都从这里起步——**确认阶段不许跳过它**
 * （见文件头：留痕里的 title/messageCount 必须是服务端自己读到的事实）。
 */
async function readThread(
  deps: ImportThreadDeps,
  input: { readonly userId: string; readonly threadId: string },
): Promise<{ readonly title: string; readonly messages: readonly ChatMessageRow[]; readonly truncated: boolean; readonly omittedAfter?: number }> {
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
  /**
   * 迭代 16（#3773 R3）—— 截断**首尾兼顾**，不是只取最近 N 条。
   *
   * 原来只取最近 N 条，理由是「前面那些早已被后面推翻的需求会把摘要带偏」。这话对了一半：
   * 后面的结论确实该赢。但一条讨论线程的**开头几条**往往是需求原文——"我们要做一个什么"，
   * 而那正是摘要最需要、后面再也不会重复一遍的东西。只取尾部的实际表现是：
   * 摘要里全是细节修正，读完不知道这是个什么产品。
   *
   * 所以留最早的几条 + 最近的其余条，中间省略并**在正文里标出来**（模型要知道中间有断档，
   * 才不会把断档两侧当成连续的一段话）。
   */
  return { title: meta.title, ...selectImportMessages(all) };
}

/** 留痕文案。**在同一处**声明，api 写它、前端只渲染 `chat` 里的字符串，不各拼一份。 */
export function importTraceText(imported: C.ImportedThread, truncated: boolean): string {
  return (
    `从线程《${imported.title}》导入了 ${imported.messageCount} 条消息作为背景。` +
    /*
     * 迭代 16（#3773 R3）：截断从「只取最近 N 条」改成**首尾兼顾**之后，这句话也得跟着改。
     *
     * 留着「只读了最近 N 条」就是一句**不准确的留痕**——实际读的是开头几条 + 最近的部分。
     * 留痕的全部价值在于半年后它说的还是真话；改了行为不改这句话，等于亲手造了一份
     * 会骗人的证据，而这正是它本来要防的那件事（静默截断）。
     */
    (truncated
      ? `（线程更长，只读了开头 ${IMPORT_HEAD_MESSAGES} 条与最近的部分，中间略过）`
      : "")
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

  const { title, messages, truncated, omittedAfter } = await readThread(deps, {
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
    const { problem, criteria } = await summarize(deps, messages, omittedAfter);
    return { project: await loadProjectView(deps, input.projectId), imported, summary: problem, criteria, truncated };
  }

  // ── 确认：写用户编辑之后的那段文本 + 留痕。两次仓储调用，顺序同 `appendProjectChat`：
  //    先写字段、后追加留痕。反过来失败 ⇒ 对话里写着「已导入」而背景没变，那是对用户撒谎。
  const updated = await deps.projects.update(input.projectId, input.ownerId, {
    problem: input.problem,
    // 迭代 16（#3773 R3）：给了才写。省略 = 不动项目现有的 criteria，**不是**清空——
    // 老调用方（不带这个字段）的行为必须逐字不变。
    ...(input.criteria === undefined ? {} : { criteria: [...input.criteria] }),
  });
  if (updated === null) throw new DesignProjectNotOwnerError();
  const traced = await deps.projects.appendChat(input.projectId, input.ownerId, [
    { role: "ai", text: importTraceText(imported, truncated), source: "system" },
  ]);
  if (traced === null) throw new DesignProjectNotOwnerError();

  return {
    project: await loadProjectView(deps, input.projectId),
    imported,
    summary: input.problem,
    criteria: input.criteria ?? [],
    truncated,
  };
}

async function summarize(
  deps: ImportThreadDeps,
  messages: readonly ChatMessageRow[],
  omittedAfter?: number,
): Promise<{ readonly problem: string; readonly criteria: readonly string[] }> {
  if (messages.length === 0) throw new DesignThreadSummaryUnavailableError();
  let text: string;
  try {
    const completion = await deps.model.complete({
      modelProvider: deps.chatModel.provider,
      modelId: deps.chatModel.modelId,
      system: SYSTEM_PROMPT,
      user: `对话内容：\n${transcriptOf(messages, omittedAfter)}`,
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
  /**
   * 迭代 16（#3773 R3）：输出改成 JSON（problem + criteria）之后，**不按 JSON 说话不算失败**。
   *
   * 模型用大白话答了一段背景，那段话本身仍然是它读完对话写的、仍然有用——照旧当 problem
   * 交给用户编辑，只是没有 criteria。判失败会让「模型这次没按格式说话」升级成
   * 「这次导入用不了」，那是把格式问题的代价转嫁给用户。
   */
  let problem = text;
  let criteria: readonly string[] = [];
  try {
    const obj = extractJsonObject(text) as Record<string, unknown>;
    const p = typeof obj.problem === "string" ? obj.problem.trim() : "";
    if (p !== "") problem = p;
    criteria = parseImportedCriteria(obj.criteria);
  } catch {
    deps.log("import-thread: summary was not JSON, using whole text as problem", { length: text.length });
  }
  return { problem: problem.slice(0, 4000), criteria };
}

/** 逐条过契约（非字符串 / 空串 / 超长丢弃），最多 `IMPORT_THREAD_MAX_CRITERIA` 条。抽不到 ⇒ `[]`。 */
export function parseImportedCriteria(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) {
    const parsed = C.ImportedCriterion.safeParse(typeof c === "string" ? c.trim() : c);
    if (parsed.success) out.push(parsed.data);
    if (out.length >= C.IMPORT_THREAD_MAX_CRITERIA) break;
  }
  return out;
}
