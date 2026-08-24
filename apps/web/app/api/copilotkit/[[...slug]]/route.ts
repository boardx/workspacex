/**
 * DA-19 CopilotRuntime 后端适配器 —— `POST/GET /api/copilotkit`.
 *
 * ## 为什么这个文件现在存在（人类 2026-08-24 裁决，issue #1967）
 *
 * #654 原裁决第 1 条排除的是"经典 CopilotKit GraphQL runtime 代替直连 AG-UI"这条
 * 后端拓扑——`copilotkit-preview-panel.tsx` 因此手写了一个最小 `HttpAgent` 驱动的
 * 聊天面板，绕开 `@copilotkit/react-core` 的 hooks。人类 2026-08-24 撤回了这条排除：
 * `useCopilotReadable`/`useCopilotAction`/`useAgent` 等 hooks 自带的
 * `skills/react-core/SKILL.md` 明写 `requires: copilotkit/runtime`——本仓唯一装过的
 * 相关包 `@copilotkit/runtime-client-gql` 包名自带 `gql`、依赖 `graphql`，没有绕过
 * GraphQL 拿到真 hooks 的办法。DA-19a 已验证的 AG-UI 直连不作废：CopilotRuntime
 * 支持把已有 AG-UI 端点注册为 `remoteEndpoints`（`agents` 记录里的一个
 * `HttpAgent`），新的这层是**适配器**，不是重新对接一次。见
 * `.harness/state/deepagent-copilotkit-backlog.md` DA-19 节 + issue #1967。
 *
 * ## 这层做什么，不做什么
 *
 * 做：把浏览器发来的 GraphQL/CopilotRuntime 协议请求（`useAgent`/`CopilotKit`
 * provider 打的 `/api/copilotkit/*`）转发到 DA-19a 已加固的
 * `POST /copilotkit/agui`（`apps/api/src/interface/controllers/
 * copilotkit-agui.controller.ts`）——鉴权（bearer token 透传）、续聊、错误传播
 * 全部复用那条端点已经做好的实现，这里只是 `CopilotRuntime` 的 `agents` 记录
 * 里挂一个指向它的 `HttpAgent`（`@ag-ui/client`，与 `copilotkit-preview-panel.tsx`
 * 用的同一个类）。
 *
 * 不做：不重新实现鉴权或续聊逻辑；不在这层做多 agent 目录解析（本仓仍然没有
 * "列出组织 agent 目录"的路由，见 `copilotkit-agui.controller.ts` 同一个已如实
 * 暴露的缺口）——`COPILOTKIT_V2_AGENT_ID` 是本轮范围内唯一可寻址的已发布 agent。
 *
 * ## agentId：为什么是一个环境变量，不是 query 透传
 *
 * `CopilotRuntime.agents` 的 key（这里固定叫 `default`）是**前端 `useAgent({agentId})`
 * 认的那个 id**，与后端 `/copilotkit/agui?agentId=` 要求的真实已发布 agent id
 * 是两个独立的命名空间——CopilotKit 协议本身没有"把 query 参数透传给 remoteEndpoint
 * URL"的机制（`HttpAgent` 的 `url` 在构造时就固定了）。`COPILOTKIT_V2_AGENT_ID`
 * 是服务端专用变量（不带 `NEXT_PUBLIC_` 前缀——不需要进浏览器 bundle，`route.ts`
 * 只在 Next 服务端进程里跑），未设置时直接 500（诚实失败，不猜一个默认 agent id）。
 *
 * ## 鉴权：把浏览器发来的 Authorization 头原样转发给 AG-UI 端点
 *
 * `AgentsFactory`（`(ctx: { request: Request }) => Record<string, AbstractAgent>`）
 * 让 `agents` 按请求动态构造——这是官方文档指出的"多租户/请求级配置"场景的正规用法
 * （`node_modules/@copilotkit/runtime/skills/runtime/references/setup-endpoint.md`
 * 与 `.../references/wiring-external-agents.md` 都用静态 `HttpAgent`，这里改成
 * 工厂是因为要读每个请求各自的 token，不是凭空发明）。真实 token 来自
 * `app/chat/copilotkit-v2/copilotkit-v2-providers.tsx` 的 `<CopilotKit headers>`
 * prop（`useState` 惰性初始化 + `useMemo` 稳定引用，见该文件头的完整实测记录——
 * 不是写死值），没有它，`copilotkit-agui.controller.ts` 的 `assertPrincipal`
 * 会诚实地 401，而不是本层伪造一个身份。
 */
import { CopilotRuntime, createCopilotRuntimeHandler, type AgentsFactory } from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { apiBaseUrl } from "@/lib/api-client";

const BASE_PATH = "/api/copilotkit";

function requiredAgentId(): string {
  const id = process.env.COPILOTKIT_V2_AGENT_ID;
  if (id === undefined || id.trim() === "") {
    throw new Error(
      "COPILOTKIT_V2_AGENT_ID is required for the DA-19 CopilotRuntime adapter — see app/api/copilotkit/route.ts file head.",
    );
  }
  return id;
}

const agents: AgentsFactory = ({ request }) => {
  const agentId = requiredAgentId();
  const authorization = request.headers.get("authorization");
  return {
    default: new HttpAgent({
      url: `${apiBaseUrl()}/copilotkit/agui?agentId=${encodeURIComponent(agentId)}`,
      // 真实转发浏览器请求自带的 Authorization 头；未登录请求没有这个头，
      // 下游 `copilotkit-agui.controller.ts` 的 `assertPrincipal` 会如实 401，
      // 不在这一层伪造一个 header 掩盖过去。
      headers: authorization !== null ? { Authorization: authorization } : {},
    }),
  };
};

const runtime = new CopilotRuntime({ agents });

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: BASE_PATH,
  hooks: {
    onError: ({ error, route }) => {
      // eslint-disable-next-line no-console -- 运行时可观测性，与其它 route.ts 同一惯例。
      console.error("[copilotkit-runtime]", route?.method, error);
    },
  },
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
