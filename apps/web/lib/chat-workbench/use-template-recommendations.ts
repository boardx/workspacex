"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { recommendCanvasTemplates, summarizePersonaFromThread } from "@/lib/live-chat";
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
/**
 * issue #2694 修复——画布模板建议 chip 的关闭状态，按 **(线程, 模板 key)** 持久化到
 * `localStorage`。关闭是"这次不想再看到它"，与"后端已经产出过这个模板"是两件独立的
 * 事实（服务端 `recommendCanvasTemplates` 已经把画过的模板从推荐里剔掉了，这里管的是
 * 另一半：还没画、但用户现在不想画）。
 *
 * 只做本地持久化、不写后端：这条 chip 本身不是任何领域状态，"用户不想再看到一条
 * 建议"不需要一次服务端往返，与"这条线程后端落库了什么"那类事实不是同一类东西，
 * 不应该被同一条纪律要求。
 *
 * ⚠ `persona` 用的仍然是 issue #2694 时代那个**不带模板 key 的旧键名**（issue #2825
 *   把这条 chip 从写死的一条泛化成整排推荐时保留的）——换一个新键名不会报错，只会让
 *   所有此前主动关掉过「生成用户画像」的人在升级后又看到它一次。那是一次没有任何
 *   好处的静默回归，而兼容它的成本就是下面这一个三目。
 */
const PERSONA_SUGGESTION_DISMISSED_KEY_PREFIX = "chat-persona-suggestion-dismissed:";
const TEMPLATE_SUGGESTION_DISMISSED_KEY_PREFIX = "chat-template-suggestion-dismissed:";
function templateSuggestionDismissKey(threadId: string, templateKey: string): string {
  return templateKey === "persona"
    ? PERSONA_SUGGESTION_DISMISSED_KEY_PREFIX + threadId
    : `${TEMPLATE_SUGGESTION_DISMISSED_KEY_PREFIX}${threadId}:${templateKey}`;
}
export function readTemplateSuggestionDismissed(threadId: string, templateKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(templateSuggestionDismissKey(threadId, templateKey)) === "1";
  } catch {
    // 隐私模式 / 存储被禁：静默降级为"没关闭过"，不让这个非核心便利功能炸整个面板。
    return false;
  }
}
function writeTemplateSuggestionDismissed(threadId: string, templateKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(templateSuggestionDismissKey(threadId, templateKey), "1");
  } catch {
    // 同上——写失败不影响本次会话内已经生效的 state，只是刷新后关闭状态丢失。
  }
}

export function useTemplateRecommendations({ agent, initialChatThreadId, projectId = null, archived, personaThreadHasPersistedEvidence, onMessageSent }: {
  projectId?: string | null;
  agent: AbstractAgent; initialChatThreadId: string | null; archived: boolean;
  personaThreadHasPersistedEvidence: boolean; onMessageSent?: () => void;
}) {
  const [templateRecommendations, setTemplateRecommendations] = React.useState<
    readonly { readonly key: string; readonly displayName: string; readonly prompt: string }[]
  >([]);
  /**
   * 取一次推荐。**只在这三种时刻**跑，不做轮询：
   *   ① 线程确认有落库消息之后（挂载 / 本轮新建线程 resolve 完）；
   *   ② 一次 run 跑完（`agent.isRunning` 落回 false）——模型可能刚产出一份画布，
   *     推荐清单要跟着变（画完旅程图，就不该继续推荐旅程图）；
   *   ③ persona 汇总成功之后（它不是一次 agent run，`isRunning` 不会动）。
   *
   * 失败静默吞掉：建议行是锦上添花，一次 404/网络抖动不该在聊天面板上多一条红字
   * （服务端同一条纪律——模板库读不到时返回空 `items` 而不是报错）。
   */
  const refreshTemplateRecommendations = React.useCallback(async (threadId: string) => {
    try {
      const bearer = getStoredSessionToken() ?? undefined;
      // `projectId` 恒传 `null`：v2 外壳管的全是个人线程，与本文件其余 chat 读调用
      //  （`getThread`/`landAsArtifact`）同一个既有约定，见 `copilotkit-v2-shell.tsx`。
      const out = await recommendCanvasTemplates(threadId, projectId, bearer);
      setTemplateRecommendations(out.items);
    } catch {
      setTemplateRecommendations([]);
    }
  }, [projectId]);
  React.useEffect(() => {
    if (initialChatThreadId === null || archived || !personaThreadHasPersistedEvidence) {
      setTemplateRecommendations([]);
      return;
    }
    if (agent.isRunning) return; // 跑完再取——run 途中的答案下一秒就过期了。
    void refreshTemplateRecommendations(initialChatThreadId);
  }, [
    initialChatThreadId, archived, personaThreadHasPersistedEvidence,
    agent.isRunning, refreshTemplateRecommendations,
  ]);

  /**
   * ── issue #2053 CK-P6「生成用户画像」（差距表 #6）────────────────────────────
   *
   * 平移旧轨道 `chat-live-message-panel.tsx` 的 `runPersonaSummary`：一次
   * `POST /chat/threads/:threadId/persona-summary`，扫全线程产出画像，产物以一条
   * assistant 消息（```mermaid mindmap 围栏）落回线程，走既有
   * `MarkdownMessage → ChatDiagramFabric` 通道渲染。
   *
   * ## 与旧轨道**唯一**的实现差异，以及为什么必须有这个差异
   *
   * 旧轨道的 `messages` 本身就是 `listMessages` 读回来的持久化消息，取
   * `messages[messages.length - 1].id` 当锚点天然就是 `chat_messages.id`。
   * 本轨道的 `agent.messages` 是 **AG-UI 流式消息**——它里面的 id 只有"挂载时从
   * 后端灌回的历史"那一段等于 `chat_messages.id`，本次会话里新流进来的那些是
   * CopilotKit/AG-UI 自己生成的、后端**不认识**的 id（本文件头注早就记录过这是两个
   * 独立命名空间）。直接拿 `agent.messages` 末条的 id 去调，在"刚发完一条消息就点
   * 生成画像"这条最常见的路径上必然拿到一个后端查不到的锚点——那正是本仓反复禁止的
   * 「点了才报错的假按钮」。所以这里点击时**现读一次**持久化消息
   * （`readAllPersistedMessages`），锚点取其最后一条。
   *
   * 结果回显同理：用契约回给的 `out.resultMessageId` 去那份持久化读回里定位那条
   * assistant 消息，**只追加这一条**到 `agent.messages`，不整体覆盖——覆盖会杀掉
   * 在途 run 已经流进来的内容（与上面历史灌回那段是同一条纪律）。
   *
   * 失败**原样回显 reasonCode**，不糊一句「生成失败」（旧轨道同款；契约 err 有三档：
   * NOT_VISIBLE / NO_WRITE_ROLE / STORAGE_UNAVAILABLE，用户对它们的处置完全不同）。
   */
  const [personaRunning, setPersonaRunning] = React.useState(false);
  const [personaFailure, setPersonaFailure] = React.useState<string | null>(null);
  /**
   * 2026-08-30 重设计：「生成用户画像」从恒定不变的独立按钮，改成建议行里按上下文
   * 出现/消失的一条（人类原话「他应该是动态的建议的行为，不能是固定的」）。
   * `personaGeneratedOnce` 是「本次会话是否已经成功生成过一次」的本地信号——
   * 见下方 `showPersonaSuggestion` 的完整判据与已知局限说明。
   */
  const [personaGeneratedOnce, setPersonaGeneratedOnce] = React.useState(false);
  /**
   * issue #2694 修复（issue #2825 泛化）——建议 chip 的关闭状态，按模板 key 分别记。
   * `dismissedTemplateKeys` 只是本次渲染要用的**内存投影**，权威在 `localStorage`
   * （见文件头 `readTemplateSuggestionDismissed`）：关闭是"针对这一条线程的这一个
   * 模板"，线程切换时整份丢弃、按新线程重读。
   */
  const [dismissedTemplateKeys, setDismissedTemplateKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  React.useEffect(() => {
    // 线程切换：关闭状态不跨线程带过去。清空即可——下面 `visibleSuggestions` 每次
    // 都对当次推荐列表现读一次 `localStorage`，不需要在这里预先把整个键空间扫一遍
    // （也扫不了：推荐了哪几个模板要等服务端回来才知道）。
    setDismissedTemplateKeys(new Set());
  }, [initialChatThreadId]);
  const dismissTemplateSuggestion = React.useCallback((templateKey: string) => {
    setDismissedTemplateKeys((prev) => new Set([...prev, templateKey]));
    if (initialChatThreadId !== null) writeTemplateSuggestionDismissed(initialChatThreadId, templateKey);
  }, [initialChatThreadId]);
  const runPersonaSummary = React.useCallback(async () => {
    if (initialChatThreadId === null || personaRunning) return;
    setPersonaRunning(true);
    setPersonaFailure(null);
    try {
      const bearer = getStoredSessionToken() ?? undefined;
      const { messages: persisted } = await readAllPersistedMessages(initialChatThreadId, bearer);
      const anchor = persisted[persisted.length - 1];
      if (anchor === undefined) {
        setPersonaFailure("这条对话还没有已落库的消息，无法生成画像。");
        return;
      }
      const out = await summarizePersonaFromThread(initialChatThreadId, anchor.id, bearer);
      const { messages: after } = await readAllPersistedMessages(initialChatThreadId, bearer);
      const result = after.find((m) => m.id === out.resultMessageId);
      if (result === undefined) {
        // 服务端说写了、读回却没有——不假装成功，也不假装失败：如实说清楚现状与出路。
        setPersonaFailure("画像已生成，但没能立刻读回那条消息。刷新页面即可看到。");
        return;
      }
      if (!agent.messages.some((m) => m.id === result.id)) {
        agent.setMessages([...agent.messages, result]);
      }
      // 成功之后这条建议就该从建议行里消失——不然用户会看到同一条"生成用户画像"
      // 一直挂在已经生成过的对话下面，重新点一次除了多花一次模型调用什么也不会
      // 变（`buildPersonaLanding` 是幂等的全量重扫，不是增量）。
      setPersonaGeneratedOnce(true);
      // issue #2825——画像不是一次 agent run（`agent.isRunning` 不会动），所以取推荐
      // 的那个 effect 不会自己重跑；这里显式再取一次：画完画像，推荐行应该立刻换成
      // 「用户旅程图 / 同理心地图」这些下一步，而不是等下一次对话才更新。
      void refreshTemplateRecommendations(initialChatThreadId);
      // 画像同时落了一件产物（`out.artifactId`）——通知外壳刷新右栏「产物」栏，
      // 与 `send()` 里 run settle 后那次是同一个通道、同一个理由。
      onMessageSent?.();
    } catch (failure) {
      setPersonaFailure(
        failure instanceof ApiError
          ? `生成用户画像失败：${failure.reasonCode ?? `HTTP ${failure.status}`}`
          : failure instanceof Error
            ? `生成用户画像失败：${failure.message}`
            : "生成用户画像失败。",
      );
    } finally {
      setPersonaRunning(false);
    }
  }, [agent, initialChatThreadId, onMessageSent, personaRunning, refreshTemplateRecommendations]);

  return { templateRecommendations, personaGeneratedOnce, personaRunning, personaFailure,
    dismissedTemplateKeys, dismissTemplateSuggestion, runPersonaSummary };
}
