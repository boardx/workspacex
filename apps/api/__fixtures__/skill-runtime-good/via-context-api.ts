/**
 * 不过火 fixture：**合法**的 skill 取数写法，门控必须放行。
 *
 * 一个会把正确写法也点红的门控会被静音——本仓已有两次先例
 * （lint-omission-reason 误报 42 处、lint-contract-source 误报 5 处正确的 z.infer 派生）。
 */
import type { ContextApiPort } from "../../src/application/skill/ports";

export async function loadContext(port: ContextApiPort, runId: string) {
  return port.requestContextPack({ runId, orgId: "o1", principalId: "p1", query: "q" });
}
