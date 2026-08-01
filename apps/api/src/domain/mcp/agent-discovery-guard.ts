/**
 * F54 (UC-21.2 R3 步骤 9-10 / R12 V8-V9) -- 开关四：禁止 agent 自行发现新 MCP 服务器.
 *
 * ## 为什么这不是"读一下 `SecurityPolicy.agentSelfDiscoversMcp`"就完了
 *
 * 契约已经把该字段焊死成 `z.literal(false)`——**读它永远只能读到 false**。真正需要一个
 * 判定函数的原因是：判定不依赖这个字段的运行时取值，而是"这台服务器是否在管理员登记的
 * 清单里"这件事实。即便有人绕过契约在数据库里塞进一条 `true`（不可能，但防御性地不假设
 * 契约会一直被遵守），这个函数依然会拒绝对未登记服务器的发现尝试——**锁不靠一个可能被
 * 篡改的布尔值单点失效**。
 *
 * ⚠ 与 F53 `authorizeMcpScopeLayer1` 是**两个不同的判定点**：那里判的是"对一台**已登记**
 *   服务器的调用是否被允许"，这里判的是"这次调用引用的服务器**根本不在登记清单里**"——
 *   一个 agent 编出一个不存在的 `serverId` 直接尝试连接，不会命中任何一条 F53 的判定分支
 *   （F53 的输入本就假设服务器已存在），必须在更早一步单独挡。
 *
 * ⚠ **叠加策略**（R7 / V9）：即便契约允许开关四打开（phase-2），agent 发现的新服务器
 *   仍然走开关一的默认隔离——两条策略独立生效，不是"开了发现就等于开了使用"。本文件的
 *   `assertAgentCannotDiscover` 判定与 `security-policy.ts` 的隔离判定**互不替代**。
 */
export interface AgentDiscoveryAttempt {
  readonly requestedServerId: string;
  readonly requestedByAgentId: string;
  /** 组织管理员登记过的服务器全集——不在其中即视为"agent 自己发现的" */
  readonly knownServerIds: readonly string[];
}

export type AgentDiscoveryCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "AGENT_CANNOT_DISCOVER_MCP";
      readonly detail: string;
    };

export function assertAgentCannotDiscover(
  attempt: AgentDiscoveryAttempt,
): AgentDiscoveryCheckResult {
  if (attempt.knownServerIds.includes(attempt.requestedServerId)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "AGENT_CANNOT_DISCOVER_MCP",
    detail: `agent "${attempt.requestedByAgentId}" 尝试接入未登记的 MCP 服务器 "${attempt.requestedServerId}"`,
  };
}
