"use client";

import * as React from "react";
import { z } from "zod";
import { useRenderTool, useDefaultRenderTool } from "@copilotkit/react-core/v2";
import { Loader2, CheckCircle2, ListTodo, FileSearch, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * DA-19c 工具可见性（框架版 Gap 1/4，issue backlog `DA-19c`）—— `/chat/copilotkit-v2`
 * 路由上用 CopilotKit v2 官方 `useRenderTool` 注册 per-tool 卡片，替代 `agent-tool-chain.tsx`
 * 手写的 `ToolChainStepBody` 分发逻辑（PR #1943 在旧手写面板上做过一次，本次是同样效果的
 * 框架版：进行中/完成态由 `@copilotkit/react-core/v2` 自己的状态机驱动，不是我们手动维护
 * `in_progress` 记账分支）。API 形状取自包自带文档
 * `node_modules/@copilotkit/react-core/skills/react-core/references/rendering-tool-calls.md`，
 * 不是凭记忆写的——`useRenderTool` 的注册函数、`status` 是 camelCase
 * `"inProgress" | "executing" | "complete"`（不是 `"in-progress"`）、`RenderToolProps`
 * 判别式联合按状态收窄 `parameters`/`result`，都逐字对照过那份文档与
 * `dist/copilotkit-D0aAnD3i.d.mts:2340-2423` 的类型声明。
 *
 * ## 三态映射——为什么不是逐字复刻 `AgentRunStepStatus`
 *
 * `packages/contracts/src/wave2-runtime.ts` 的 `AgentRunStepStatus` 是
 * `"succeeded" | "failed" | "in_progress"`——`agent-tool-chain.tsx` 直接读这个持久化字段。
 * 但这条新轨道的传输层是 AG-UI 协议（`copilotkit-agui.controller.ts` 的
 * `writeToolCallStep`），而 `@ag-ui/core` 的 `ToolCallResultEventSchema`
 * （`node_modules/@ag-ui/core/dist/index.d.ts:4434-4442`）**没有** `error`/`isError` 字段——
 * 一次工具调用的结果永远只是一个 `content: string`，`useRenderTool` 的
 * `RenderToolCompleteProps.result` 类型也逐字是 `string`，不是
 * `{ok: boolean, text: string}` 这类结构。协议本身就不携带"这次调用是成功还是失败"的
 * 布尔信号，只有内容文本——`copilotkit-agui.controller.ts` 自己的注释也如实写着：失败时
 * `resultContent` 是 `step.toolResultSummary ?? 「技能"X"执行失败。」`，与成功时用的是**同一个
 * `content` 字段**，客户端没有任何独立通道能把两者机械区分开。
 *
 * 因此这里**不伪造**一个"失败"红色徽标去冒充能区分 succeeded/failed——那需要对 `result`
 * 文本做启发式字符串嗅探，命中率不可控，属于"编一个视觉上像是真实信号的假状态"，与本仓
 * 反假数据纪律冲突。诚实的映射是：
 *   - 契约的 `in_progress` → CopilotKit 的 `"inProgress"`（参数还在流式组装）与
 *     `"executing"`（参数已完整、结果还没回来）——两者合并成一种「进行中」视觉（转圈 +
 *     已知参数），因为对用户而言两者都是"还没有结果"。
 *   - 契约的 `succeeded`/`failed` → CopilotKit 的 `"complete"`——`result` 文本原样展示，
 *     这正是 `copilotkit-agui.controller.ts` 那条"失败必须以文本可见，不能悄悄空着"
 *     （chat-ux-acceptance-criteria.md 第 7 项「错误处理透明度」）的验收点：不需要一个
 *     额外的红色徽标，失败原因本身就在可见文本里。
 *
 * 另一个如实登记的限制（与本仓 `deep-agent-model-provider.ts` 的
 * `extractToolCallEvents` 一致）：当前唯一的生产 `DeepAgentModelProvider` 只上报
 * `phase: "in_progress" | "complete"` 两种工具调用阶段，从不对单次工具调用标记
 * `status: "failed"`（run 整体失败走的是另一条路径——`MODEL_CALL_FAILED`，不落在任何一个
 * `tool_call` step 上，`agent-tool-chain.tsx` 的 `runFailed` prop 就是为这种情况单独开的口）。
 * 也就是说，"单次工具调用失败"这个分支在当前唯一真实上游下几乎不会被触发——如实记录，
 * 不假装验证过一个目前打不到的分支。
 */

const writeTodosParametersSchema = z.object({
  todos: z.array(z.object({ content: z.string(), status: z.string() })),
});

const searchDocumentsParametersSchema = z.object({ query: z.string() });

const TODO_STATUS_TEXT: Record<string, string> = {
  pending: "待办",
  in_progress: "进行中",
  completed: "已完成",
};

/** 进行中/已完成的小圆点图标——两条自定义卡片共用，避免各写一份。 */
function ToolStatusIcon({ status }: { status: "inProgress" | "executing" | "complete" }) {
  if (status === "complete") {
    return <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />;
  }
  return <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
}

/**
 * `write_todos` 定制卡片——真实计划条目列表，不是一坨 JSON。与旧手写面板
 * `agent-tool-chain.tsx` 的 `WriteTodosCard` 展示思路一致（三态图标 + 划线已完成项），
 * 但 props 形状不同：这里吃框架已经解析好的 `parameters.todos`（对象数组），不是需要自己
 * `JSON.parse` 的 `toolArgsSummary` 字符串——复用的是渲染思路，不是复用组件本身。
 */
function WriteTodosCard({
  status,
  parameters,
}: {
  status: "inProgress" | "executing" | "complete";
  parameters: Partial<z.infer<typeof writeTodosParametersSchema>>;
}) {
  const todos = Array.isArray(parameters.todos) ? parameters.todos : null;
  return (
    <Card data-testid="copilotkit-v2-tool-write-todos" data-tool-status={status}>
      <CardContent className="flex flex-col gap-1.5 p-2.5 text-11">
        <div className="flex items-center gap-1.5 font-medium text-card-foreground">
          <ToolStatusIcon status={status} />
          <span>write_todos</span>
          {status !== "complete" ? (
            <Badge tone="neutral" data-testid="copilotkit-v2-tool-write-todos-in-progress-badge">
              进行中
            </Badge>
          ) : null}
        </div>
        {todos === null ? (
          <p className="text-10 text-muted-foreground" data-testid="copilotkit-v2-tool-write-todos-pending">
            {status === "complete" ? "本次没有可解析的计划条目。" : "计划条目正在组装…"}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" data-testid="copilotkit-v2-tool-write-todos-list">
            {todos.map((todo, i) => {
              const content = typeof todo?.content === "string" ? todo.content : null;
              const todoStatus = typeof todo?.status === "string" ? todo.status : null;
              if (content === null) return null;
              return (
                <li key={i} className="flex items-center gap-1.5 text-10">
                  <ListTodo
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0",
                      todoStatus === "completed" ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      todoStatus === "completed" && "text-muted-foreground line-through",
                    )}
                  >
                    {content}
                  </span>
                  {todoStatus !== null ? (
                    <span className="shrink-0 text-muted-foreground">
                      {TODO_STATUS_TEXT[todoStatus] ?? todoStatus}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** 抽出"看起来像文件名"的 token（`xxx.ext`）——与 `agent-tool-chain.tsx` 的
 * `SearchDocumentsCard` 同一条正则，抽不出就老实回退显示原文本，不编一个空列表。 */
function extractFilenames(text: string): string[] {
  return [...text.matchAll(/[^\s，,。:：]+\.[A-Za-z0-9]{1,6}/g)].map((m) => m[0]);
}

/**
 * `search_documents` 定制卡片——结果渲成文档条目列表。与旧手写面板同名组件展示思路一致，
 * props 形状不同：这里吃框架的 `parameters.query`（已解析对象）+ `result`（已经是最终
 * 字符串，不需要区分 `toolResultSummary`/`toolArgsSummary` 两个字段）。
 */
function SearchDocumentsCard({
  status,
  parameters,
  result,
}: {
  status: "inProgress" | "executing" | "complete";
  parameters: Partial<z.infer<typeof searchDocumentsParametersSchema>>;
  result: string | undefined;
}) {
  const query = typeof parameters.query === "string" ? parameters.query : null;
  const files = status === "complete" && typeof result === "string" ? extractFilenames(result) : [];
  return (
    <Card data-testid="copilotkit-v2-tool-search-documents" data-tool-status={status}>
      <CardContent className="flex flex-col gap-1.5 p-2.5 text-11">
        <div className="flex items-center gap-1.5 font-medium text-card-foreground">
          <ToolStatusIcon status={status} />
          <span>search_documents</span>
          {status !== "complete" ? (
            <Badge tone="neutral" data-testid="copilotkit-v2-tool-search-documents-in-progress-badge">
              进行中
            </Badge>
          ) : null}
        </div>
        {query !== null ? (
          <p className="flex items-center gap-1.5 text-10 text-muted-foreground">
            <FileSearch aria-hidden className="h-3 w-3 shrink-0" />
            检索词：{query}
          </p>
        ) : null}
        {status !== "complete" ? (
          <p className="text-10 text-muted-foreground" data-testid="copilotkit-v2-tool-search-documents-pending">
            检索中…结果尚未返回
          </p>
        ) : files.length > 0 ? (
          <ul className="flex flex-col gap-0.5" data-testid="copilotkit-v2-tool-search-documents-list">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 text-10 text-card-foreground">
                <FileText aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{f}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-10 text-card-foreground" data-testid="copilotkit-v2-tool-search-documents-raw-result">
            {result}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 挂载点——渲染 `null`，只负责调用 `useRenderTool`/`useDefaultRenderTool` 把渲染器注册进
 * `CopilotKit` provider 的全局登记表（`copilotkit.addHookRenderToolCall`）。
 * `CopilotKitV2Panel` 用的 `CopilotChatMessageView`/`CopilotChatAssistantMessage` 会自动
 * 消费这张登记表，不需要再手动把 `toolCalls` 传给谁——这就是 `useRenderTool` 被文档称为
 * "Primary registration hook" 的含义。挂载顺序不敏感：三个 hook 各自 `useEffect` 注册，
 * 与 `CopilotKitV2Panel` 是否已经挂载无关，所以放在同一个组件里、panel 内部渲染即可。
 */
export function CopilotKitV2ToolRenderers(): null {
  useRenderTool(
    {
      name: "write_todos",
      parameters: writeTodosParametersSchema,
      render: ({ status, parameters }) => <WriteTodosCard status={status} parameters={parameters} />,
    },
    [],
  );
  useRenderTool(
    {
      name: "search_documents",
      parameters: searchDocumentsParametersSchema,
      render: ({ status, parameters, result }) => (
        <SearchDocumentsCard status={status} parameters={parameters} result={result} />
      ),
    },
    [],
  );
  // 其余工具（`read_document`/`lookup_time`/未来新增的工具）没有专属卡片，走框架自带的
  // 默认可展开卡片——`useDefaultRenderTool()` 不传 `render` 就是"用内置默认卡片"
  // （见 rendering-tool-calls.md "Wildcard fallback with the built-in card"），不要求
  // 覆盖所有工具，与旧手写面板 `ToolChainStepBody` 的 `default: GenericToolBody`
  // 同一条纪律：没有专属渲染不是缺陷，是设计。
  useDefaultRenderTool();
  return null;
}
