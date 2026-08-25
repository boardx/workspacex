/**
 * issue #2038 —— `/api/copilotkit` 适配层（`app/api/copilotkit/[[...slug]]/route.ts`）
 * 给下游 `/copilotkit/agui` 拼 agent 选择 query 的纯函数。
 *
 * 单独成文件的原因：Next.js app router 的 route.ts 只允许导出 HTTP 方法等固定名字，
 * 导出别的会在构建期报类型错——而这段"header 选择 / env 兜底 / 空着让服务端解析"
 * 的三态分支正是 devapp 实测事故（env 被配成 `agent_versions.id`，未选 agent 首屏
 * 全挂）的接线处，值得一个不用起 Next 服务就能跑的单测。语义全文见 route.ts 里
 * `resolveAgentQuery` 的头注与 `copilotkit-agui.controller.ts` 的
 * `resolveEffectiveAgentId`。
 *
 * 三态：
 * - header 有选择 → `?agentId=<选中>`（用户意志，严格）；
 * - 没选择但 env 配了 → `?agentId=<env>&agentIdSource=env-default`（配置兜底，
 *   服务端在请求方 org 下验真，验不过落 org 动态默认 + 警告日志）；
 * - 都没有 → 空串（服务端按 principal 的 org 解析动态默认）。
 */
export function buildAguiAgentQuery(
  selectedHeader: string | null,
  envAgentId: string | undefined,
): string {
  const selected = selectedHeader?.trim();
  if (selected !== undefined && selected !== "") {
    return `?agentId=${encodeURIComponent(selected)}`;
  }
  const envId = envAgentId?.trim();
  if (envId !== undefined && envId !== "") {
    return `?agentId=${encodeURIComponent(envId)}&agentIdSource=env-default`;
  }
  return "";
}
