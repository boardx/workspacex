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
 * 不做：不重新实现鉴权或续聊逻辑；不做多 agent **编制**（roster——把多个 agent 同时
 * 加进一个会话协作）——见 issue #2023 PR 说明的范围取舍，那是明显更大的一块工作。
 *
 * ## agentId：per-request header 优先，环境变量兜底（issue #2023 更新，此前固定环境变量）
 *
 * `CopilotRuntime.agents` 的 key（这里固定叫 `default`）是**前端 `useAgent({agentId})`
 * 认的那个 id**，与后端 `/copilotkit/agui?agentId=` 要求的真实已发布 agent id
 * 是两个独立的命名空间——CopilotKit 协议本身没有"把 query 参数透传给 remoteEndpoint
 * URL"的机制（`HttpAgent` 的 `url` 在构造时就固定了）。issue #1967 首版因此把这个真实
 * agent id 写死进 `COPILOTKIT_V2_AGENT_ID` 环境变量——浏览器侧那时压根没有"选择 agent"
 * 这回事。issue #2023（差距清单第 4 项）接上了 `AgentPicker`：`resolveAgentId()`
 * 现在优先读浏览器随请求带来的 `COPILOTKIT_V2_SELECTED_AGENT_HEADER`（见
 * `copilotkit-v2-agent-header.ts`/`resolveAgentId` 自己的文件内注释），环境变量降级为
 * "没有选择时的默认值"——未设置且也没有选择时仍然直接抛错（诚实失败，不猜一个默认
 * agent id），这一点没有变。
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
import { COPILOTKIT_V2_SELECTED_AGENT_HEADER } from "@/lib/copilotkit-v2-agent-header";

const BASE_PATH = "/api/copilotkit";

/**
 * 2026-08-25（#2026 翻转后 devapp 实测）：本 handler 在**服务端**给 `HttpAgent` 的
 * 出站地址。生产同机拓扑（Caddy 同源反代）下不能用 `apiBaseUrl()`（= 公网
 * `NEXT_PUBLIC_API_URL`）——那会让 Next 服务端绕公网打回同一台 Caddy，而
 * `/api/copilotkit/*` 恰好整段是本 handler 自己的 basePath，Caddy 把请求送回
 * Next 自己，稳定拿到 404 HTML，用户侧表现为发消息即 RUN_ERROR（真实事故，
 * wire 抓包定位）。deploy.env 里现成的 `APP_API_PORT`（provision.sh 单一声明处，
 * systemd EnvironmentFile 注入）就是内网 NestJS 端口——存在时直连 127.0.0.1
 * 回环，一跳到位，不经 Caddy。e2e / 本地 dev 不设这个变量，行为与之前逐字节
 * 相同（`apiBaseUrl()` 直连测试 API 端口）。
 */
function aguiOrigin(): string {
  const internalPort = process.env.APP_API_PORT?.trim();
  if (internalPort) return `http://127.0.0.1:${internalPort}`;
  return apiBaseUrl();
}

function requiredAgentId(): string {
  const id = process.env.COPILOTKIT_V2_AGENT_ID;
  if (id === undefined || id.trim() === "") {
    throw new Error(
      "COPILOTKIT_V2_AGENT_ID is required for the DA-19 CopilotRuntime adapter — see app/api/copilotkit/route.ts file head.",
    );
  }
  return id;
}

/**
 * issue #2023（差距清单第 4 项）—— 浏览器侧选中的 agent id 优先。
 *
 * `copilotkit-v2-agent-header.ts` 头注已经记录了为什么是 header、不是 query param
 * （CopilotKit 协议没有把 query 参数透传给 remoteEndpoint URL 的机制，`HttpAgent.url`
 * 在构造时就固定了）。这里读的是**浏览器发给 `/api/copilotkit/*` 这条请求**自己的
 * header（`request.headers`，与下面读 `authorization` 是同一个 `Request` 对象、
 * 同一条已验证可靠的通道），不是下游 `/copilotkit/agui` 的 query string——那条
 * query string 仍然存在，只是它的值现在从这里派生，不再是编译期写死的环境变量。
 *
 * 缺失/空白时回退到 `requiredAgentId()`（未选择任何 agent，或组织没有可用 agent 时
 * `copilotkit-v2-panel.tsx` 不会带这个 header）——与本任务之前的行为逐字节相同，
 * 不悄悄改变"没有选择时用什么"这条既有默认语义。
 */
function resolveAgentId(request: Request): string {
  const selected = request.headers.get(COPILOTKIT_V2_SELECTED_AGENT_HEADER);
  if (selected !== null && selected.trim() !== "") return selected.trim();
  return requiredAgentId();
}

/**
 * ⚠ 已知边界（issue #2023 任务说明，2026-08-25 实测确认，如实登记，不在本任务内解决）：
 * `agent_versions` 按 org RLS 隔离，一个 org 选中的 agent id 对另一个 org 可能根本不
 * 可见/不存在——`resolvePublished(orgId, agentId)`（`copilotkit-agui.controller.ts`
 * 下游）会诚实地 404/`AGENT_NOT_FOUND`，不会跨租户泄漏。本任务只解决"浏览器侧能不能
 * 选、选完会不会真的路由过去"，不解决"选出来的候选列表在多租户场景下该怎么过滤"这个
 * 更大的问题——候选本身来自 `listCapabilities(orgId, "agent")`，已经按请求方所在 org
 * 过滤过，本层不需要也不应该重复这条判断。
 */
const agents: AgentsFactory = ({ request }) => {
  const agentId = resolveAgentId(request);
  const authorization = request.headers.get("authorization");
  return {
    default: new HttpAgent({
      url: `${aguiOrigin()}/copilotkit/agui?agentId=${encodeURIComponent(agentId)}`,
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
