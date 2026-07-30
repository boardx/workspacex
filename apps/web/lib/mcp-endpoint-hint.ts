import type { z } from "zod";
import * as AR from "@repo/contracts/agent-runtime";

/**
 * 端点 → **粗粒度归属提示**（F52 / domain I-6）。
 *
 * ## 为什么是一个函数而不是每屏各写一句
 *
 * I-6 要求的是「端点原值不到非管理员手上」。契约那一侧已经落了
 * （`McpServerRow` 根本没有 `endpoint` 键，只有两值的 `endpointHint`），
 * 但**原型屏拿的是 mock 的完整对象**，那里端点原值是有的——于是「露不露」
 * 退化成每个组件各自的自觉，而靠自觉的落法，加一块屏就漏一次。
 *
 * 这个函数是那条投影的唯一入口：**取值域就是契约的两个值**，
 * 返回类型由契约推出来，多一个档位都过不了 typecheck。
 *
 * ⚠ 它**不是**脱敏：脱敏是把原值处理一下再给出去，仍然是一条从原值到输出的通道。
 *   这里输出的是一个 bit，且调用点拿到的是这个 bit 而不是原值。
 *
 * ⚠ 判定规则只在这里有一份。散在各屏各写一遍 `endsWith(".internal")`，
 *   等于把「什么算内网」变成没人守的事——而它决定的是要不要把地址露出去。
 */
export type McpEndpointHint = z.infer<typeof AR.McpServerRow>["endpointHint"];

export function mcpEndpointHint(endpoint: string): McpEndpointHint {
  const host = endpoint
    .replace(/^[a-z0-9+.-]+:\/\//i, "")
    .split("/")[0]!
    .split(":")[0]!
    .toLowerCase();

  const internal =
    host === "localhost" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^127\./.test(host);

  return internal ? "内网" : "外网";
}
