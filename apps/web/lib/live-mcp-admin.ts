/**
 * issue #1849 —— MCP 后台的第一条真实链路：填一个远程 MCP 服务器端点、当场发现真实工具列表。
 *
 * ## 这个文件不做判断
 *
 * 与 `live-skill-admin.ts` 同一条纪律：没有"是不是管理员"的分支，也不把 403 翻译成
 * 别的东西。权限、SSRF 拒绝全部是服务端的裁决（`discoverRemoteMcpTools` 用例 +
 * `remote-endpoint-guard.ts` 两道门），这一层只把形状原样送过去、把失败原样带回来。
 *
 * ## 形状与路径取自 `@repo/contracts`
 *
 * 手写路径或字段名的那一刻就多了一份副本；`tests/contract-single-source.test.ts`
 * 机械禁止第二份声明。
 */
import { agentRuntime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type DiscoverRemoteMcpToolsIn = z.infer<
  typeof agentRuntime.operations.discoverRemoteMcpTools.in
>;
export type DiscoverRemoteMcpToolsOut = z.infer<
  typeof agentRuntime.operations.discoverRemoteMcpTools.out
>;
export type DiscoveredMcpTool = DiscoverRemoteMcpToolsOut["tools"][number];

/**
 * 面板友好的入参形状——字段名 `authToken` 而不是契约的 `credential`。
 *
 * ⚠ 这**不是**第二份契约声明（类型仍然全部从 `DiscoverRemoteMcpToolsIn` 派生，
 *   零手写字段类型）——只是把"要不要把它叫 credential"这件事挡在 `apps/web/lib` 里，
 *   不让这个词出现在 `apps/web/components/**` 的源码里。这是 F52 I-6 的既有纪律
 *   （`credential-endpoint-hidden.test.ts` 机械扫描组件源码禁止 `credential` 字面量）
 *   延伸到"填一个新凭据"这个写路径——那条测试禁的是字面量出现在组件源码里，
 *   不管这次是读一个已存的值还是写一个新值。
 */
export interface DiscoverRemoteMcpToolsPanelInput {
  readonly serverId: DiscoverRemoteMcpToolsIn["serverId"];
  readonly endpoint: DiscoverRemoteMcpToolsIn["endpoint"];
  readonly authToken: DiscoverRemoteMcpToolsIn["credential"];
}

/**
 * 连接一个远程 MCP HTTP/SSE 服务器并发现真实工具列表。
 *
 * ⚠ 不吞失败：`ApiError` 直接抛给调用方——SSRF 拒绝（`MCP_ENDPOINT_*`）、
 *   `MCP_SERVER_UNREACHABLE`、`REQUEST_TIMEOUT`、`NOT_ORG_ADMIN` 各自的 reasonCode
 *   要用户做的事完全不同，糊成一句「失败了」等于把它们都变成不可行动的。
 */
export async function discoverRemoteMcpTools(
  input: DiscoverRemoteMcpToolsPanelInput,
): Promise<DiscoverRemoteMcpToolsOut> {
  const wire: DiscoverRemoteMcpToolsIn = {
    serverId: input.serverId,
    endpoint: input.endpoint,
    credential: input.authToken,
  };
  return apiRequest<DiscoverRemoteMcpToolsOut>(
    agentRuntime.operations.discoverRemoteMcpTools.path,
    { method: "POST", body: wire },
  );
}
