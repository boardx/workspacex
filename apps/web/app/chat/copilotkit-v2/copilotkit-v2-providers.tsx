"use client";

// issue #2039 —— 框架消息节点的本仓补样式（用户气泡/工具条等，见该 CSS 头注）。
// import 放在本文件而不是旧灰度路由的 layout.tsx：#2044 起正式承载树
// （app/chat/copilotkit-v2-experience.tsx）不经过那个 layout，两棵树唯一共用的
// 挂点就是本 provider 组件——单一声明点，样式随 provider 走到哪棵树都在。
import "./copilotkit-v2.css";
import * as React from "react";
import { usePathname } from "next/navigation";
import { CopilotKit, useAgentContext } from "@copilotkit/react-core/v2";
import { getStoredSessionToken } from "@/lib/api-client";
import { useCopilotKitV2AgentSelection } from "@/lib/copilotkit-v2-agent-selection";
import { COPILOTKIT_V2_SELECTED_AGENT_HEADER } from "@/lib/copilotkit-v2-agent-header";

/**
 * DA-19f —— `useCopilotReadable`/`useAgentContext` 接线基座（issue 见 PR 描述）。
 *
 * 本条**只**证明"provider 级 hook 接线真的把前端状态注入到 agent 推理请求里"这件事
 * 本身能工作——注入什么内容（该注 @ 引用文件、还是右栏视窗/选中片段）是 DA-14 的
 * 权威范围，本文件不重复声明、不做那个产品决策。这里注入的是一个**最小、确定性**
 * 的探针值（当前路由 pathname + 一个固定测试标记字符串），只为了在 wire 层能
 * 无歧义地断言到——不是真实产品内容。
 *
 * `@copilotkit/react-core/v2` 没有导出叫 `useCopilotReadable` 的 hook（那是 legacy
 * `@copilotkit/react-core`（v1）API）；这个包版本（1.66.4）的对应能力是
 * `useAgentContext`（见包自带 `skills/react-core/references/agent-access.md`：
 * "declarative push of app state to every agent run"）。任务标题沿用 DA-19f 在
 * backlog 里的历史命名，接线的实际 hook 以这份包内文档为准，不凭记忆猜 API。
 *
 * 数据流（`@copilotkit/core@1.66.4` `dist/index.mjs` 实测读源码确认，不是猜测）：
 * `useAgentContext` → `ContextStore.addContext` → `CopilotKitCore._internal
 * .getContextForAgent(agentId)` → 每次 `copilotkit.runAgent()` 把它塞进
 * `agentRunInput.context`（`[{description, value}]`，`value` 经 `JSON.stringify`）
 * → 经 `ProxiedCopilotRuntimeAgent` 落进 `POST /api/copilotkit/agent/:id/run` 的
 * 请求体 `context` 字段——这条链路本身就是"到达 agent 推理上下文"的可验证边界，
 * wire 层断言见 `apps/web/e2e/copilotkit-v2-agent-context.spec.ts`。
 *
 * 必须是 `CopilotKit` 的子组件（`useAgentContext` 内部读 `useCopilotKit()` 的
 * context），所以在这里而不是 `CopilotKitV2Providers` 外层调用；只做 provider 级
 * 接线，不碰 `copilotkit-v2-panel.tsx` 的消息渲染（DA-19b 范围）。
 */
const READABLE_CONTEXT_PROBE_MARKER = "DA-19F-READABLE-CONTEXT-PROBE";

function CopilotKitV2ReadableContextProbe(): null {
  const pathname = usePathname();

  const value = React.useMemo(
    () => ({ pathname, probe: READABLE_CONTEXT_PROBE_MARKER }),
    [pathname],
  );

  useAgentContext({ description: "DA-19f wiring probe: current route + fixed marker", value });

  return null;
}

/**
 * DA-19 CopilotRuntime 适配器 —— provider，只挂在 `/chat/copilotkit-v2` 这一条路由下
 * （见本目录 `layout.tsx`），不碰根 `app/providers.tsx`/生产 `/chat`。
 *
 * `runtimeUrl` 指向新起的 `app/api/copilotkit/[[...slug]]/route.ts`（可选 catch-all——
 * 实测 `createCopilotRuntimeHandler` 的路由发现请求会打裸 `basePath` 本身，比如
 * `GET /api/copilotkit/info` 之外，`AgentRegistry` 也会直接对裸 `/api/copilotkit`
 * 发单路由探测；必选 catch-all `[...slug]` 接不住零段路径，404），那层再把请求转发到
 * DA-19a 已加固的 `POST /copilotkit/agui`（见该 route 文件头）。
 *
 * ## 鉴权：`headers` prop（`useMemo` 稳定引用），不是 imperative `setHeaders`
 *
 * provider-setup.md 的「Stable headers for rotating auth tokens」示例建议用
 * `useEffect` + `copilotkit.setHeaders` 命令式设置。本轮 e2e 实测踩到：那条路径下
 * 服务端 `route.ts` 的 `AgentsFactory` 收到的 `Authorization` 头始终是
 * `null`（加了一次性调试日志核实：`GET /info`、`POST /agent/default/run` 全部
 * `authorization present: false`），即使浏览器早已登录、`localStorage` 里确有 token、
 * `setHeaders` 调用本身没有报错。反证②（清空 token 后必须失败的那个 test）却始终
 * 稳定通过——说明"没有 Authorization 头"这条路径工作正常，"有 Authorization 头"这条
 * 反而从没真正发生过，指向 imperative `setHeaders` 与 provider 自身"prop 变化时用
 * prop 派生 headers 整体覆盖"的机制打架（文档原话："Whenever any provider prop
 * changes, the provider calls `setHeaders` with its prop-derived headers — a full
 * overwrite"）——本组件没传 `headers` prop 时，派生结果就是空对象，任何触发"prop
 * 变化"判定的重渲染都会把刚设进去的 `Authorization` 冲掉。改成把 token 放进
 * `useMemo` 稳定的 `headers` prop（provider-setup.md 同一份文档"HIGT — Inline
 * object props rebuilt every render"给出的推荐模式）后，反证①（真实回合，需要
 * token 生效）稳定通过——这是本仓唯一确认过在这个包版本上真实可靠的鉴权接线方式。
 */
/**
 * issue #2023（差距清单第 4 项）—— 补的一段：`headers` useMemo 现在还带上
 * `COPILOTKIT_V2_SELECTED_AGENT_HEADER`，值来自 `useCopilotKitV2AgentSelection()`
 * （`CopilotKitV2AgentSelectionProvider` 包在本组件外层，见 `layout.tsx`）。
 *
 * 复用的正是上面这段头注刚验证过的机制——"prop-derived headers, full overwrite"，
 * `Authorization` 已经证明这条通道对这个包版本可靠；这里只是往同一个 `useMemo` 里
 * 多塞一个 key，不是另开一条新通道。依赖数组多了 `selectedAgentId`：用户切换 agent
 * 时这个 memo 换新引用，provider 判定"prop 变了"，下一次请求带上新值。
 *
 * `selectedAgentId === null`（agent 列表还没加载完，或组织没有可用 agent）时不带这个
 * header——`route.ts` 的 `AgentsFactory` 对缺失时的行为是回退到 `COPILOTKIT_V2_AGENT_ID`
 * 环境变量（与本任务之前的行为逐字节相同），不是本层猜一个默认值。
 */
export function CopilotKitV2Providers({ children }: { children: React.ReactNode }): JSX.Element {
  // `useState(() => getStoredSessionToken())` —— 惰性初始化，值在**首次渲染就**
  // 同步读到，不是 `useState(null)` 再靠 `useEffect` 在下一帧才补上。实测（本轮 e2e，
  // 多次交替出现 `HTTP 401: unauthenticated` 与成功）：`useState(null)` 版本让首帧
  // 的 `headers` 恒为 `{}`，`useAgent()` 在这一帧构造出的底层 proxied agent 有一定
  // 概率把这份空 `headers` 用到实际发出的请求上，即使随后几帧 `token` state 更新、
  // `headers` prop 换了新引用——这是"构造时机偶然踩中空档"的时序竞争，不是每次都发生，
  // 靠 `page.waitForTimeout` 加大延迟也压不住（等的是错误的东西）。惰性初始化让首帧
  // 就是最终值，消灭这个空档本身，而不是试图跑赢它。
  const [token, setToken] = React.useState<string | null>(() => getStoredSessionToken());
  const { selectedAgentId } = useCopilotKitV2AgentSelection();

  React.useEffect(() => {
    const sync = (): void => setToken(getStoredSessionToken());
    // 登录/登出发生在另一个标签页或本页面的其它组件时都要跟上，`storage` 事件覆盖前者，
    // 轮询覆盖后者（`localStorage.setItem` 不在同一文档内触发 `storage` 事件）。
    window.addEventListener("storage", sync);
    const interval = window.setInterval(sync, 2000);
    return () => {
      window.removeEventListener("storage", sync);
      window.clearInterval(interval);
    };
  }, []);

  const headers = React.useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (token !== null) h.Authorization = `Bearer ${token}`;
    if (selectedAgentId !== null) h[COPILOTKIT_V2_SELECTED_AGENT_HEADER] = selectedAgentId;
    return h;
  }, [token, selectedAgentId]);

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      // 实测（本轮 e2e，DA-19）：`useSingleEndpoint` 缺省是 `undefined`（→
      // `runtimeTransport: "auto"`），会让 `AgentRegistry`/`ProxiedCopilotRuntimeAgent`
      // 分别独立探测一次「REST 多路由 vs 单路由」——`copilotkit-nRjRp2_5.mjs` 里
      // `runtimeTransport: useSingleEndpoint === true ? "single" : useSingleEndpoint
      // === false ? "rest" : "auto"`，源自 `packages/react-core/src/v2/hooks/
      // use-copilotkit.ts`（编译产物里的注释路径）。本仓 `route.ts` 只实现了默认的
      // 多路由模式（`GET /info` + `POST /agent/:id/run` 等），从不支持单路由的
      // `{method,params,body}` envelope；显式传 `false` 把 `runtimeTransport` 锁定为
      // `"rest"`，跳过探测——不是绕开一个偶发 bug，是如实声明"这个部署只有一种协议"。
      useSingleEndpoint={false}
      headers={headers}
      onError={handleCopilotError}
      /*
       * issue #2039（UIUX 三轮迭代第 1 轮 gap #1）—— `CopilotKit` wrapper 对
       * `showDevConsole`/`enableInspector` 的缺省值是 `isLocalhost()`（读
       * `copilotkit-nRjRp2_5.mjs` 的 `shouldShowDevConsole`：`undefined` ⇒ 按
       * hostname 是否 localhost/127.0.0.1 决定）——而 devapp 恰恰跑在 127.0.0.1
       * 回环上（PROJECT.md「本机端口分配」），于是右上角的 CopilotKit Inspector
       * 浮动按钮 + 它自带的厂商新闻弹窗（实测抓到 "The Channels SDK is live,
       * plus CopilotKit for Angular!"，内容从 copilotkit 云端拉取）直接暴露给
       * 真实用户。这是开发者工具漏进产品界面，不是产品功能——显式关掉，两个
       * prop 都传 `false`（`showDevConsole` 已废弃但 wrapper 仍读它决定 usage
       * banner/toast，`enableInspector` 决定 inspector 本体，见 wrapper 源码
       * `shouldShowDevConsole(props.showDevConsole)` / `(props.enableInspector)`
       * 两处独立调用）。排障入口不受影响：`onError` 的 console.error 仍在。
       */
      showDevConsole={false}
      enableInspector={false}
    >
      <CopilotKitV2ReadableContextProbe />
      {children}
    </CopilotKit>
  );
}

function handleCopilotError({
  type,
  error,
  context,
}: {
  type: string;
  error?: unknown;
  context: unknown;
}): void {
  // #1966 实测：这个包版本（1.66.4）的 `<CopilotKit onError>` 类型是
  // `@copilotkit/shared` 的 `CopilotErrorHandler`（`{type, timestamp, context, error?}`），
  // 不是 provider-setup.md 示例写的 `{code, error, context}`——`tsc` 报
  // `Property 'code' does not exist on type 'CopilotErrorEvent'` 时改用这个真实形状，
  // 不凭文档示例硬猜。是模块级常量，不是内联箭头函数——避免每次渲染都是新引用，
  // 触发 provider 把它当"prop 变了"进而重置 `headers`（同上头注）。
  // eslint-disable-next-line no-console -- DA-19 适配器排障用，provider-setup.md 明确要求 onError。
  console.error("[copilotkit-v2]", type, error, context);
}
