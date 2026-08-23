/**
 * issue #1849 —— `McpToolStore`（`application/mcp/ports.ts`）的第一个实现，**进程内存**。
 *
 * ⚠ `ports.ts` 头注逐字写着 F52 刻意不带 PostgreSQL 实现——持久化服务器与工具的表结构
 *   属于 F53/F54（评审记录、安全开关）该决定的形状，提前建表是在猜一个还没定的接口。
 *   本文件不是在补那个 PostgreSQL 实现（那仍然是 F53/F54 的事），只是让
 *   `discoverMcpTools` 在**这一轮**有一个真实可用的落点，而不是每次调用都对着一个假的
 *   store——没有它，"发现出真实工具列表"里的"变更集"（added/removed/signatureChanged）
 *   永远是空的，因为根本没有"上一次发现的结果"可比对。
 *
 * ⚠ **进程重启即丢失**——这是诚实的限制，不是缺陷；调用方（尤其是 UI）不应假设重新发现
 *   之间的状态跨进程存活。
 */
import type { z } from "zod";
import type { McpTool } from "@repo/contracts/agent-runtime";
import type { McpToolStore } from "../../application/mcp/ports";

export function createInMemoryMcpToolStore(): McpToolStore {
  const bySever = new Map<string, readonly z.infer<typeof McpTool>[]>();
  return {
    async current(serverId) {
      return bySever.get(serverId) ?? [];
    },
    async replace(serverId, tools) {
      bySever.set(serverId, tools);
    },
  };
}
