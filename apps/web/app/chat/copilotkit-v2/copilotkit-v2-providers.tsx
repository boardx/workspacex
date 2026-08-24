"use client";

import * as React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { getStoredSessionToken } from "@/lib/api-client";

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
    return h;
  }, [token]);

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
    >
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
