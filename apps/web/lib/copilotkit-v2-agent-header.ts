/**
 * issue #2023（差距清单第 4 项）—— 浏览器侧选中的真实已发布 agent id，经这个自定义
 * header 从 `<CopilotKit headers>` 传给 `app/api/copilotkit/[[...slug]]/route.ts` 的
 * `AgentsFactory`。
 *
 * ## 为什么是 header，不是 query param
 *
 * `route.ts` 文件头已经记录过：`CopilotRuntime.agents` 的 key（固定叫 `"default"`）
 * 与后端 `/copilotkit/agui?agentId=` 要求的真实已发布 agent id 是两个独立命名空间，
 * CopilotKit 协议本身没有"把 query 参数透传给 remoteEndpoint URL"的机制。但
 * `Authorization` 头已经被证明能从 `<CopilotKit headers>` prop 一路稳定送到
 * `AgentsFactory({request})`（`copilotkit-v2-providers.tsx` 文件头的完整实测记录）——
 * 这条通道是本仓唯一已验证过对**这个包版本**可靠的"per-request 动态值→
 * `AgentsFactory`"路径，加一个同源自定义 header 是复用它，不是新发明一条机制。
 *
 * ## 单独抽成这个文件，不写进 `copilotkit-v2-agent-selection.tsx`
 *
 * `route.ts` 是服务端专用文件，`copilotkit-v2-agent-selection.tsx` 顶部有
 * `"use client"`——虽然 Next.js 允许服务端模块 import 客户端模块的非组件具名导出，
 * 但把这个常量放进一个没有 `"use client"` 的纯字面量模块，两侧 import 路径更直白，
 * 不依赖这条边界特例。
 */
export const COPILOTKIT_V2_SELECTED_AGENT_HEADER = "x-workspacex-copilotkit-v2-agent-id";
