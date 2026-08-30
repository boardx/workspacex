"use client";

import * as React from "react";
import { Wrench, ChevronDown, ChevronUp } from "lucide-react";
import {
  useConfigureSuggestions,
  useSuggestions,
  CopilotChatAssistantMessage,
  CopilotChatToolCallsView,
} from "@copilotkit/react-core/v2";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import {
  CopilotKitV2CopyButton,
  CopilotKitV2MessageExtraActions,
  useCopilotKitV2MessageActions,
  CopilotKitV2MessageLandingTrigger,
  CopilotKitV2MessageLandingPanel,
} from "@/components/chat/copilotkit-v2-message-actions";
import { ProducedFileInlineCard } from "@/components/chat/produced-file-inline-card";
import type { ActiveFile } from "@/lib/agui-file-events";

/**
 * 2026-08-30（引用文件规模纪律拆分）—— 本文件从 `copilotkit-v2-panel.tsx` 拆出：
 * `V2MarkdownRenderer`/`ArtifactLandingCtx`/`V2AssistantMessage`/`FollowUpSuggestions`
 * 只消费 props 与自己的 context，不闭包依赖 `CopilotKitV2PanelBody` 的任何内部
 * 状态，天然可独立成文件。原文件当时已过 2000 行的业务源文件规模上限（AGENTS.md
 * 硬约束）。行为逐字节未变，唯一改动是文件边界与 import 路径——`ArtifactLandingCtx.
 * Provider` 仍由 `copilotkit-v2-panel.tsx` 的 JSX 包裹（那部分状态在那一层），
 * 这里只搬 Context 对象本身与消费它的组件。
 *
 * `CopilotChatAssistantMessage` 的 `markdownRenderer` slot 替换实现——见
 * `copilotkit-v2-panel.tsx` 文件头 "DA-19b 消息渲染迁移"整段。类型直接取自框架自己
 * 导出的默认实现（`CopilotChatAssistantMessage.MarkdownRenderer`），不是手抄一份
 * 容易漂移的签名；只用其中的 `content`，其余 Streamdown 专属渲染选项（`shikiTheme`
 * 等）本组件不消费，因为渲染管线换成了 `MarkdownMessage`（react-markdown + mermaid
 * fabric），不是 Streamdown 的产物，这些选项对它没有意义。
 *
 * issue #2070 —— `threadId`/`messageId`/`bearer` 现在是可选透传参数：这条通道此前只转
 * `content`，`MarkdownMessage → ChatCanvasFabric`/`ChatDiagramFabric` 因此拿不到落地
 * 产物所需的三要素，画布/mermaid 图编辑保存后退回"本地演示"（只更新内存 state，从不
 * 调 `landAsArtifact`），刷新必丢。三者由下面 `V2AssistantMessageImpl` 在 slot 边界之外
 * 另开的通道注入；这个组件本身仍然只认 `content` 是必需的，缺失三者时原样透传
 * `undefined` 给 `MarkdownMessage`——退回"本地演示"是它自己已有的诚实降级，这里不
 * 重复判断一次。
 */
function V2MarkdownRenderer({
  content,
  threadId,
  messageId,
  bearer,
}: React.ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer> & {
  threadId?: string;
  messageId?: string;
  bearer?: string;
}): JSX.Element {
  return <MarkdownMessage text={content} threadId={threadId} messageId={messageId} bearer={bearer} />;
}

/**
 * 2026-08-30 人类实测反馈——「展示的 tools 的调用历史应该简化放在一个统一的 panel，
 * 可以缩放，目前的 uiux 不对」。此前 `copilotkit-v2-tool-renderers.tsx` 给每个工具
 * 调用（`list_org_skills`/`ls`/`glob`×N/`write_file`……）各注册一张独立的 Card，
 * 通用助手一轮跑下来常常是七八次探测性调用（找字体、列目录），逐张卡片纵向堆叠，
 * 把真正的回复挤到几屏之下——用户等的是"文件生成了没有"，不是逐条工具调用记录。
 *
 * `CopilotChatAssistantMessage` 恰好留了一个我们此前没用过的 slot——`toolCallsView`
 * （框架自带 `CopilotChatToolCallsView` 的替换点，读 `message.toolCalls` 逐条分派给
 * 已注册的 per-tool 渲染器，见框架源码 `CopilotChatToolCallsView.tsx`）。这里不重写
 * 分派逻辑（那是 `copilotkit-v2-tool-renderers.tsx` 里 `useRenderTool`/
 * `useDefaultRenderTool` 已经做的事，各工具卡片本身不变），只是把框架默认"直接摊平
 * 渲染"的位置，换成一个折叠面板——收起时只显示一行"工具调用 · N 步"，展开后原样
 * 渲染每张已有卡片，容器给 `max-h` + 内部滚动（"可以缩放"里"可滚动查看全部"这半句
 * 落地的方式；真正的窗口缩放交给浏览器自身，这里不做拖拽 resize，那是本仓目前没有
 * 先例的一整套新交互，本次不追加）。
 *
 * ⚠ 只有 1 次工具调用时不折叠——直接展开渲染：折叠一次调用没有信息密度上的收益，
 *   只会让用户多点一次。
 *
 * ⚠ 默认**展开**，不是默认收起：`copilotkit-v2-tool-rendering.spec.ts` 等既有 e2e
 *   在发消息后直接断言某张工具卡片 `toBeVisible()`，不会先去点开一个折叠面板——
 *   默认收起会让这些断言在"这一轮恰好不止一次工具调用"时全部落空（元素根本没
 *   渲染，不是被 CSS 藏起来）。收起是**用户自己按需要点**的动作，不是本次改动
 *   替用户做的默认判断；真正解决的是"逐张卡片散落一地"——现在至少收进同一个
 *   容器，视觉上是一组，不是不相关的 N 个浮动卡片。
 */
function V2ToolCallsView(
  props: React.ComponentProps<typeof CopilotChatToolCallsView>,
): JSX.Element | null {
  const toolCalls = props.message.toolCalls ?? [];
  const [expanded, setExpanded] = React.useState(true);
  // `React.useId()`：同一个组件实例在其生命周期内稳定不变（`aria-controls`
  // 引用的 id 不会在重渲染之间跳变），且天然跨组件实例互不相同（同一屏多条
  // 消息各自的折叠面板不会撞 id）。
  const groupId = React.useId();

  if (toolCalls.length === 0) return null;
  if (toolCalls.length === 1) return <CopilotChatToolCallsView {...props} />;

  return (
    <div
      className="flex flex-col rounded-lg border border-border-subtle bg-muted/30"
      data-testid="copilotkit-v2-tool-calls-group"
      data-tool-calls-count={toolCalls.length}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={groupId}
        data-testid="copilotkit-v2-tool-calls-group-toggle"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-11 text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Wrench aria-hidden className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1 text-left">
          {expanded ? "收起工具调用" : `工具调用 · ${toolCalls.length} 步`}
        </span>
        {expanded
          ? <ChevronUp aria-hidden className="h-3 w-3 shrink-0" />
          : <ChevronDown aria-hidden className="h-3 w-3 shrink-0" />}
      </button>
      {/* `id` 恒定存在（不随 `expanded` 卸载）：`aria-controls` 引用的元素必须真的在
          DOM 里，辅助技术才能建立"这个按钮控制那个区域"的关系；折叠态用 `hidden`
          属性隐藏内容，而不是整段不渲染——两者对视觉的效果一样，但前者保留了
          可引用、可查询的元素，后者会让 `aria-controls` 指向一个不存在的 id。 */}
      <div
        id={groupId}
        role="region"
        aria-label="工具调用详情"
        hidden={!expanded}
        className="flex max-h-64 flex-col gap-1.5 overflow-y-auto border-t border-border-subtle p-2"
        data-testid="copilotkit-v2-tool-calls-group-body"
      >
        <CopilotChatToolCallsView {...props} />
      </div>
    </div>
  );
}

/**
 * issue #2070 —— `threadId`/`bearer` 供 `V2AssistantMessageImpl` 里的落地产物接线用。
 * 单独开一个 context 而不是塞进旁边 `CopilotKitV2MessageActionsContextValue`
 * （`copilotkit-v2-message-actions.tsx`，CK-P3 owns 的文件）：那个 context 的职责是
 * "消息级操作"（复制/评分/反馈），落地产物是另一件事，混进去会让那个文件的读者以为
 * 评分/反馈也要关心 threadId——两件事只是恰好都要挂在 `assistantMessage` slot 上，
 * 不是同一份数据。
 *
 * ⚠ `Provider` 挂在 `copilotkit-v2-panel.tsx`（`value` 来自那一层的
 * `artifactLandingContextValue`），这里只导出 Context 对象本身供该处 `.Provider`
 * 与本文件内 `V2AssistantMessageImpl` 的 `React.useContext` 两侧共用。
 */
export const ArtifactLandingCtx = React.createContext<{ threadId: string | undefined; bearer: string | undefined }>({
  threadId: undefined,
  bearer: undefined,
});

/**
 * 2026-08-30 人类裁决（"不要在中间加这个 column 来可视化，下载链接要在 message
 * 上"）—— agent 沙箱产出（`source: "agent_run_output"` 的 `file_created` 事件，
 * DA-16 真实生产者）此前跟其他来源的活动文件一起喂给 `ActiveFilePanel`
 * （`copilotkit-v2-panel-body.tsx`），渲染成聊天主区旁边的第二列。这类文件是生产
 * 环境里**目前唯一**真实会出现的 `activeFiles`（`chat_upload`/`artifact_pin` 两个
 * source 至今没有真实生产者，见 `agui-file-events.ts` 头注），所以那一列在人类实测
 * 里几乎每次生成 PDF/DOCX/XLSX/PPTX 都会弹出来——正是被反馈的那个"中间 column"。
 *
 * 裁决改成：这类文件的下载卡片挂到**产出它的那条助手消息**下面（本文件下方
 * `V2AssistantMessageImpl` 消费这个 context，按 `messageId` 精确过滤——
 * `AguiFileCreatedValue` 契约同批新增了 `messageId` 字段），不再单独占一列。
 * `ActiveFilePanel` 组件本身不删：它是 `chat_upload`/`artifact_pin` 未来真实
 * 生产者的既有消费端实现，只是 `agent_run_output` 不再路由给它（见
 * `copilotkit-v2-panel-body.tsx` 对应渲染处的 `panelFiles` 过滤）。
 *
 * `Provider` 挂在 `copilotkit-v2-panel-body.tsx`（那一层持有 `activeFiles` state），
 * 这里只导出 Context 对象本身，与上面 `ArtifactLandingCtx` 同一条分工理由：单独
 * 开一个 context 而不是塞进别处，因为这是另一件事，只是恰好都要挂在
 * `assistantMessage` slot 上。
 */
export const ProducedFilesCtx = React.createContext<{
  readonly files: readonly ActiveFile[];
  readonly threadId: string | null;
}>({ files: [], threadId: null });

/**
 * CK-P3（issue #2054）—— `assistantMessage` **整组件** slot 的替换实现。
 *
 * ## 为什么必须接在这一层（而不是继续用 `markdownRenderer`）
 *
 * `markdownRenderer` 子 slot 的 props 只有 `content`，**没有 `messageId`**——逐条操作
 * 在那一层接不上，#2046 已把这条路排除，别再从那里进。`CopilotChatAssistantMessageProps`
 * 在整组件这一层携带 `message`（读框架 `.d.mts` 类型确认，不是猜的）。
 *
 * ## 内部仍然渲染框架自己的 `CopilotChatAssistantMessage`
 *
 * 不另写一个气泡：那会让两条轨道的消息渲染各自漂移。这里只做四件加法——
 *   ① `markdownRenderer` 仍换成本仓 `MarkdownMessage`（DA-19b 的 markdown + mermaid
 *      fabric 能力不能因为多包了一层就回退）；
 *   ② `copyButton` 换成带本仓锚点的外观（**复用框架绑好的 `onClick`**，复制这件事
 *      本身没有第二份实现）；
 *   ③ `additionalToolbarItems` 挂上「对 agent 提反馈」+ 👍/👎 评分；
 *   ④（issue #2070）`markdownRenderer` 额外注入 `threadId`/`messageId`/`bearer`，
 *      画布/mermaid 图编辑保存才能真正落库而不是退回"本地演示"；
 *   ⑤（issue #2052，CK-P7）气泡下方再挂一个兄弟节点 `CopilotKitV2MessageLanding`，
 *      「落地为产物」的三态交互——块级 UI，进不了①③已占的行内 slot。
 *
 * ## （issue #2070）`messageId` 为什么要经 `identity.resolve`，不能直接用 `props.message.id`
 *
 * `props.message.id` 是 `agent.messages` 里的**视图** id——本轮流式到达的 assistant
 * 消息，这个 id 是 wire 上的临时聚合 id，`chat_messages` 里没有这一行（见
 * `lib/copilotkit-v2-message-identity.ts` 文件头的完整取证，CK-P3 评分入口踩过同一个
 * 坑）。直接拿它去调 `landAsArtifact`，在"AI 刚回复完、立刻点保存"这条最常见路径上
 * 会 404——那正是本仓反复禁止的「点了才报错的假按钮」。这里复用同一份已经接好的
 * `useCopilotKitV2MessageActions().identity`（CK-P3 已建的索引，不是重新做一份平行的
 * 解析逻辑），拿不到真实主键时 `resolve` 回答 `null`，`messageId` 就诚实地是
 * `undefined`——`MarkdownMessage` 自己的 `canPersist` 判定会据此退回"本地演示"，不是
 * 在这一层再判一次。
 *
 * ## ⚠ 框架自带的 👍/👎 刻意不启用
 *
 * `CopilotChatAssistantMessage` 有 `onThumbsUp`/`onThumbsDown` 回调，看起来正好。但它们
 * 是"点一下就完事"的形状，而本仓的 👎 允许（可选地）填一句理由——`MessageRating`
 * 的整个交互（待改进 → 理由输入 → 提交 → 「已记录」/「未计入 skill 满意度」）塞不进
 * 一个 onClick。接了框架回调就等于把 F176 采集侧砍成半个，所以走
 * `additionalToolbarItems` 用完整的 `MessageRating`；框架那两个按钮不传回调也不传
 * slot，于是（读框架实现：`(onThumbsUp || thumbsUpButton) && ...`）根本不渲染，
 * 不会出现两套 👍/👎 并排。
 */
function V2AssistantMessageImpl(
  props: React.ComponentProps<typeof CopilotChatAssistantMessage>,
): JSX.Element {
  const messageId = props.message.id;
  // issue #2070 —— 见上方"messageId 为什么要经 identity.resolve"一段。`actionsCtx` 在
  // 生产路径下恒非 null（渲染点始终包在 `CopilotKitV2MessageActionsProvider` 里）；
  // 组件测试直接渲染这个 slot、不包那层 provider 时 `useCopilotKitV2MessageActions()`
  // 按其自身既有约定返回 null，这里同样如实退回"落不了地"，不是另造一条兜底路径。
  const actionsCtx = useCopilotKitV2MessageActions();
  const realMessageId = actionsCtx?.identity.resolve(messageId) ?? undefined;
  const { threadId: artifactThreadId, bearer: artifactBearer } = React.useContext(ArtifactLandingCtx);
  // issue #2052（CK-P7）—— 正文取自框架给的这条消息本身，与气泡里渲染的是同一份，
  // 不另找一处读。
  const text = typeof props.message.content === "string" ? props.message.content : "";
  /**
   * issue #2307（3/3 稳定复现，#2300 引入的回归）—— 框架 `CopilotChatAssistantMessage`
   * 内部有一条我们够不着的门：`shouldShowToolbar = toolbarVisible && hasContent &&
   * !(isRunning && isLatestAssistantMessage)`（读框架编译产物
   * `copilotkit-nRjRp2_5.mjs` 确认，不是猜测）。这条门是**整个 toolbar 容器**的
   * mount/unmount 开关，为 false 时 `additionalToolbarItems`（含下面
   * `CopilotKitV2MessageLandingTrigger`）连 DOM 都不进去，不是 CSS 隐藏。
   *
   * #2300 之前，「落地为产物」的入口是气泡下方一个独立的兄弟节点，不经过这条门，
   * 所以从不受它影响。#2300 把入口挪进了 `additionalToolbarItems`（人类反馈：应该
   * 和复制/反馈/评分同一排），这条耦合就第一次生效——而它与后端协议的时序对不上：
   * `chat_message_id` 映射事件（`lib/copilotkit-v2-message-identity.ts` 文件头）是
   * 在 run **succeeded 之后、`RUN_FINISHED` 之前**发的，也就是说"这条消息已经真实
   * 落库、可以被落地为产物"这件事，可能发生在客户端 `agent.isRunning` 还没翻回
   * `false` 的那个窗口内——恰好是 `isRunning && isLatestAssistantMessage` 为真、
   * 框架判定"整条 toolbar 都不该出现"的那一刻。真实实测里这不是"稍等一下就出现"的
   * 抖动：只要期间没有别的状态变化触发这条消息重渲染，它会一直卡在"已经可以落地、
   * 但入口没画"这个状态，用户看到的就是 issue 描述的"入口整个消失"。
   *
   * 修法：`isRunning` 只应该表达"这条消息的正文还在流式变化，此刻操作它不安全"，
   * 而 `resolvePersisted` 已经是本文件既有的、更权威的"这条消息是否已经是一行真实
   * `chat_messages` 记录"的判据（CK-P7 落地入口自己就用它，见
   * `copilotkit-v2-message-actions.tsx` 的 `resolveLandableMessage`）。一旦这条消息
   * 已经解析出真实落库 id，就不该再被"协议层的 RUN_FINISHED 还没到"卡住——内容和
   * 落库 id 都已经是终态，继续隐藏整条 toolbar（连复制都点不了）不是保护用户，是
   * 一个纯粹的时序假象。这里只对**这一条消息**改写 `isRunning`，不影响 `agent`
   * 本身的运行状态（composer 的禁用、"…"文案等别处读的仍是原始 `agent.isRunning`）。
   */
  const persistedMessageId = actionsCtx?.identity.resolvePersisted(messageId) ?? null;
  const effectiveIsRunning = props.isRunning && persistedMessageId === null;
  /**
   * 2026-08-30 —— 见 `ProducedFilesCtx` 自己的文档。按 `persistedMessageId`（真实
   * `chat_messages.id`）过滤，不是上面的 `realMessageId`（`resolve`，不保证已落库）
   * ——`file_created` 事件的 `messageId` 字段本来就是产生端从 `resultMessageId`
   * （一条已落库的 assistant 消息）填的，`resolvePersisted` 与它是同一个判据。
   * 消息还没解析出持久化 id 时 `persistedMessageId` 是 `null`，过滤结果恒为空数组——
   * 不会把这批文件错配给还没落库的那条消息。
   */
  const { files: producedFilesAll, threadId: producedFilesThreadId } = React.useContext(ProducedFilesCtx);
  const producedFiles = React.useMemo(
    () => (persistedMessageId === null ? [] : producedFilesAll.filter((f) => f.messageId === persistedMessageId)),
    [producedFilesAll, persistedMessageId],
  );
  /**
   * issue #2132（真实 devapp 实测：打字/滚动时消息区画布内容闪烁，续 #2096）—— 这是
   * #2096 那次 memo 化之外**另一处、更严重**的同类根因，不是同一个 bug 的残留。
   *
   * `markdownRenderer`/`copyButton` 这两个 slot 的静态类型是 `SlotValue<C> = C |
   * string | Partial<ComponentProps<C>>`——直接传一个箭头函数（不是一个"部分 props"
   * 对象）落在 `C` 这个分支：框架把它当作**整个 slot 的替换组件本身**，内部执行的是
   * `const MarkdownRenderer = markdownRenderer ?? Default; <MarkdownRenderer {...} />`
   * 这类"把 slot 值当组件类型用"的写法（读框架 `CopilotChatAssistantMessage` 源码
   * 确认，不是猜测）。此前这里每次 `V2AssistantMessageImpl` 重渲染（打字/滚动/任何
   * 会让这条消息重渲染的状态变化）都创建一个**新的箭头函数**——对 React 来说这是
   * "组件类型变了"，不是"props 变了"：reconciler 判定为整棵子树需要卸载重建，不是
   * 更新。子树里正是 `ChatDiagramFabric`/`ChatCanvasFabric` 渲染出的 fabric canvas
   * ——每次都被真的销毁、重新建一个新 canvas、重新解析一遍 mermaid，这才是用户看到
   * 的"画布内容闪烁"里最直接、最剧烈的那一层（#2096 修的 context value 引用稳定性
   * 只解决了"这条消息组件要不要重渲染"，没有解决"重渲染之后这两个 slot 组件的身份
   * 还是不是同一个"——两处是同一类问题的两层，缺一不成立）。
   *
   * 修法：`useCallback` 稳定这两个函数的引用身份，只在真正相关的值
   * （`artifactThreadId`/`realMessageId`/`artifactBearer`/`messageId`）变化时才
   * 重建——多数情况下这条消息重渲染时这些值都没变，两个 slot 组件因此维持"同一个
   * 组件类型"，React 走更新路径而不是卸载重建，canvas 不再被销毁重造。
   */
  const markdownRenderer = React.useCallback(
    (rendererProps: React.ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>) => (
      <V2MarkdownRenderer
        {...rendererProps}
        threadId={artifactThreadId}
        messageId={realMessageId}
        bearer={artifactBearer}
      />
    ),
    [artifactThreadId, realMessageId, artifactBearer],
  );
  const copyButton = React.useCallback(
    (copyProps: React.ComponentProps<typeof CopilotChatAssistantMessage.CopyButton>) => (
      <CopilotKitV2CopyButton onClick={copyProps.onClick} messageId={messageId} />
    ),
    [messageId],
  );
  return (
    // issue #2132（真实 devapp 实测：消息操作条位置不对）—— `gap-1` 收紧自
    // 此前的 `gap-1.5`：框架自己的 toolbar（复制/反馈/评分）与下面「落地为产物」
    // 是两个物理上分开的节点（CK-P3/CK-P7 各自的加法，见下方注释），够不着把两者
    // 塞进同一个 flex 容器统一对齐——但把间距收紧到跟框架 toolbar 内部同一量级，
    // 至少让它们读作"同一条消息下的连续操作区"，不是两个不相关的独立区块。
    <div className="flex flex-col gap-1">
      <CopilotChatAssistantMessage
        {...props}
        // issue #2307 —— 见上方 `effectiveIsRunning` 的完整推理：只对这一条消息
        // 覆盖框架自己的"是否还在跑"判断，落库 id 一旦解析出来就不再让协议层
        // `RUN_FINISHED` 的到达时序卡住整条 toolbar（含下面的落地入口）。
        isRunning={effectiveIsRunning}
        markdownRenderer={markdownRenderer}
        copyButton={copyButton}
        toolCallsView={V2ToolCallsView}
        additionalToolbarItems={
          <>
            <CopilotKitV2MessageExtraActions messageId={messageId} />
            {/* 2026-08-27（对照 Claude Design 原型）—— 「落地为产物」的触发器现在是
                与复制/反馈/评分同一排的小图标，不再自成一行。真正打开后的表单/完成态
                仍然是块级，见下方 `CopilotKitV2MessageLandingPanel`。 */}
            <CopilotKitV2MessageLandingTrigger messageId={messageId} text={text} />
          </>
        }
      />
      {/* issue #2052（CK-P7）—— 打开后的表单/提交中/出错/完成四态，需要的宽度进不了
          行内工具栏，所以仍作为气泡的兄弟节点挂在下面（未打开时它自己不渲染任何东西，
          见 `MessageLandingPanel`）。⚠ 这不是第二层 slot 包装：`assistantMessage` slot
          全仓只在本组件换这一次。它的 `messageId` 传的是视图 id（不是上面 #2070 已解析
          出的 `realMessageId`）——`CopilotKitV2MessageLandingPanel`/`Trigger` 内部自己经
          `identity.resolvePersisted` 二次解析（见 `copilotkit-v2-message-actions.tsx`），
          两处解析口径不同（`resolve` vs `resolvePersisted`），不能共用同一个已解析结果。 */}
      <CopilotKitV2MessageLandingPanel messageId={messageId} text={text} />
      {/* 2026-08-30 人类裁决——agent 沙箱产出的可下载文件（PDF/DOCX/XLSX/PPTX…）挂在
          这条消息下面，不再单独占一个中间列。见 `ProducedFilesCtx` 头注。 */}
      {producedFiles.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="chat-produced-files-inline">
          {producedFiles.map((file) => (
            <ProducedFileInlineCard key={file.uri} file={file} threadId={producedFilesThreadId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * slot 的静态类型是 `SlotValue<typeof CopilotChatAssistantMessage>`——即它要的不只是
 * 一个组件函数，还包括挂在同名命名空间上的那些子组件（`MarkdownRenderer`/`Toolbar`/
 * `CopyButton`/…）。`Object.assign` 把框架那份**原样**搬到包装组件上，而不是用一个
 * `as` 断言糊过去：断言只是让编译器闭嘴，任何真的去读 `.CopyButton` 的调用点（框架
 * 内部就有）会在运行期拿到 `undefined`。
 */
export const V2AssistantMessage = Object.assign(
  V2AssistantMessageImpl,
  CopilotChatAssistantMessage,
) as typeof CopilotChatAssistantMessage;

/**
 * ── DA-19e 追问建议（框架版 Gap 2，backlog issue #1962/#1967 系列）─────────────
 *
 * 旧手写面板（`chat-live-message-panel.tsx`）的追问建议手工实现过两次
 * （PR #1938 首次实现、PR #1957 修 deep-agent 线程走不通真实模型的 bug——根因是
 * 手写适配层里"建议生成"另起一条调用路径，没有复用聊天本身已经验证过的连接，
 * 导致 deep-agent 类线程命中一条没人验证过的分支）。这里用官方
 * `useConfigureSuggestions`/`useSuggestions`（`@copilotkit/react-core/v2`，见
 * `node_modules/.../react-core/skills/react-core/references/suggestions.md`）
 * 走框架自己的建议引擎——不是本仓再手写一次生成逻辑。
 *
 * **验证过、不是想当然的一点**：读 `@copilotkit/core` 源码
 * （`dist/index.mjs` `SuggestionEngine.generateSuggestions`）确认了框架内部机制——
 * `consumerAgentId`（这里传 `threadId`，即页面这个 `useAgent` 实例的本地 id）用来
 * 取到消费者的消息历史做种子；`providerAgentId`（默认 `"default"`，与
 * `runtimeAgentId="default"` 对齐）取到的是 `CopilotKitCore` 在 runtime `/info`
 * 发现阶段自动注册的远程代理——**它和本文件里 `useAgent` 走的是同一个
 * `runtimeUrl`/`CopilotRuntime` 路由**（不是另起一条连接），要么用 stateless
 * `/agent/:id/suggest` 端点、要么 clone 这个远程代理后 `runAgent`，两条路径最终
 * 都落到 DA-19a 已加固的同一个 AG-UI 桥接层。这正是"框架版相对手写版的优势"
 * 应该验证的地方：本组件没有像旧实现那样为 deep-agent 线程写任何额外适配代码，
 * 因为框架的建议引擎本身就走 agent 自己已经用于正常对话的那条连接，不存在
 * "建议生成用另一套调用形状"的分支。
 *
 * `reloadSuggestions` 不需要本组件手动触发——`CopilotKitCore.runAgent` 每次
 * agent 运行结束（含工具调用的 follow-up 循环走完之后）会自动对该 agent 的
 * `agentId` 调一次 `suggestionEngine.reloadSuggestions(agentId)`（见
 * `dist/index.mjs` 里 `this._internal.suggestionEngine.reloadSuggestions(agentId)`
 * 紧跟在 follow-up 循环之后那一处）——本组件的 `send()` 已经在调
 * `copilotkit.runAgent({ agent })`，建议是这次调用的副作用之一，不是额外接线。
 */
/**
 * 一条「本地插入」的建议 chip——不经过 CopilotKit 建议引擎，由调用方按自己的规则
 * 决定何时出现（如「生成用户画像」，见 `copilotkit-v2-panel-body.tsx` 的
 * `personaSuggestions`）。与 `s.message`（AI 建议，点击即发送）不同，它的
 * `onSelect` 是一个无参回调——点击后调用方要做的往往不是「发一条消息」，而是
 * 一次专用 API 调用（persona-summary 需要的锚点、落地流程都与普通消息发送不同）。
 *
 * ⚠ 与 CopilotKit 原生 `suggestions` **同一排渲染、同一套样式**——用户看到的是
 *   一条连贯的"建议行"，分不清（也不需要分清）哪条来自 AI、哪条来自本地规则；
 *   这正是本次重设计要的效果："生成用户画像"从一个恒定不变的独立按钮，变成
 *   这排建议里按上下文出现/消失的一条（人类原话：「他应该是动态的建议的行为，
 *   不能是固定的」，2026-08-30）。
 *
 * ⚠ `id` **直接就是** `data-testid`（不加前缀）——「生成用户画像」这条 chip 沿用
 *   了它作为独立按钮时代就有的既有锚点 `chat-persona-summary-trigger`，
 *   `copilotkit-v2-persona-archived.spec.ts`/`.test.tsx` 等既有测试与真栈 e2e
 *   都认这个 testid；换成生造的前缀（如 `copilotkit-v2-suggestion-local-xxx`）
 *   会让这些既有证据全部找不到元素而超时，本身也不是这次重设计要改的东西——
 *   变的是"什么时候出现"，不是"叫什么名字"。
 */
export interface LocalSuggestionChip {
  /** 同时也是渲染出来的 `data-testid`，逐字不加前缀。 */
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

export function FollowUpSuggestions({
  agentId,
  disabled,
  onSelect,
  localSuggestions = [],
}: {
  agentId: string;
  disabled: boolean;
  onSelect: (text: string) => void;
  /** 见 `LocalSuggestionChip` 文件头注——调用方按自己的规则算好后传入，本组件
   *  只负责渲染，不判断"什么时候该出现"（同一条规则不在两处各写一份）。 */
  localSuggestions?: readonly LocalSuggestionChip[];
}): JSX.Element | null {
  useConfigureSuggestions(
    {
      instructions:
        "结合当前对话内容，给用户 2-4 条真实相关的追问建议，贴合刚才讨论的具体主题，不要写成泛泛而谈的通用模板。",
      minSuggestions: 2,
      maxSuggestions: 4,
      available: "after-first-message",
      providerAgentId: "default",
      consumerAgentId: agentId,
    },
    [agentId],
  );
  const { suggestions, isLoading } = useSuggestions({ agentId });

  if (suggestions.length === 0 && !isLoading && localSuggestions.length === 0) return null;

  return (
    <div
      data-testid="copilotkit-v2-suggestions"
      className="flex flex-wrap gap-2"
      aria-busy={isLoading}
    >
      {localSuggestions.map((chip) => (
        <button
          key={chip.id}
          type="button"
          data-testid={chip.id}
          disabled={disabled || chip.disabled}
          className="rounded-full border border-border px-3 py-1 text-xs text-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground"
          onClick={chip.onSelect}
        >
          {chip.label}
        </button>
      ))}
      {suggestions.map((s, i) => (
        <button
          key={`${s.title}-${i}`}
          type="button"
          data-testid={`copilotkit-v2-suggestion-${i}`}
          disabled={disabled || s.isLoading}
          className="rounded-full border border-border px-3 py-1 text-xs text-foreground transition-colors duration-fast hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground"
          onClick={() => onSelect(s.message)}
        >
          {s.title || s.message}
        </button>
      ))}
    </div>
  );
}
