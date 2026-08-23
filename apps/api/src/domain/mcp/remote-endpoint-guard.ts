/**
 * issue #1852 —— 远程 MCP 端点的出站 SSRF 门，**字面量阶段**。
 *
 * ## 为什么不是新发明一套判定
 *
 * `domain/skill/import-source.ts` 已经在解决同一个问题（"服务端要不要替调用方去请求这个
 * 地址"），且它的两阶段设计（字面量 → DNS 解析后）是从一次真实教训里长出来的（见该文件
 * 头注）。这里**复用 `classifyAddress`**——地址分类的判定只有一份；本文件只重新声明
 * MCP 场景自己的错误码与准入协议（`https` 而非任意协议、`credential` 走独立字段而不是
 * 塞进 URL），因为把 skill 导入的 `IMPORT_*` 错误码原样安在 "远程 MCP 服务器地址不合法"
 * 上会让使用者读到一个跟 MCP 无关的错误族。
 *
 * ## 两道门，且第二道必须由真正发起连接的那一层调用
 *
 * `assertMcpEndpointAllowed` 只看字面量，返回规范化后的 URL。真正的地址在 DNS 解析之后
 * 才知道——`assertResolvedMcpAddressAllowed` 必须在 `infrastructure/mcp` 里、由发起 TCP/TLS
 * 连接的那个 `lookup` 回调调用，本文件挡不住一个不调用它的连接路径。
 */
import { classifyAddress } from "../skill/import-source";

export type McpEndpointRefusalCode =
  /** 不是一个能解析的绝对 URL */
  | "MCP_ENDPOINT_MALFORMED"
  /** 只允许 https：http 明文、file://、ftp://、stdio 之类一律拒——本轮只做 remote transport */
  | "MCP_ENDPOINT_SCHEME_FORBIDDEN"
  /** URL 里内嵌凭据（`https://user:pw@host/`）——凭据走独立的 `credential` 字段，不塞进 URL */
  | "MCP_ENDPOINT_CREDENTIALS_FORBIDDEN"
  /** 目标地址不在公网（loopback / 私网 / link-local / 云元数据 / 组播 / 保留段） */
  | "MCP_ENDPOINT_HOST_NOT_PUBLIC"
  /** personal-local 组织：出站承诺（I-9）不允许连接任何远程 MCP 服务器 */
  | "MCP_ENDPOINT_FORBIDDEN_FOR_LOCAL_ORG";

export class McpEndpointRefusedError extends Error {
  constructor(readonly code: McpEndpointRefusalCode) {
    super(`mcp endpoint refused: ${code}`);
    this.name = "McpEndpointRefusedError";
  }
}

export interface McpEndpointPolicy {
  /** 该组织是否处于 personal-local 出站承诺下（I-9）。为 true 时一律拒绝。 */
  readonly localOnlyOrg: boolean;
}

/**
 * 第一道门：只看字面量。返回规范化后的 URL，供调用方继续用。
 * ⚠ 通过这道门不代表可以连——host 是域名时真正的判定在 `assertResolvedMcpAddressAllowed`。
 */
export function assertMcpEndpointAllowed(raw: string, policy: McpEndpointPolicy): URL {
  if (policy.localOnlyOrg) {
    throw new McpEndpointRefusedError("MCP_ENDPOINT_FORBIDDEN_FOR_LOCAL_ORG");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpEndpointRefusedError("MCP_ENDPOINT_MALFORMED");
  }

  if (url.protocol !== "https:") {
    throw new McpEndpointRefusedError("MCP_ENDPOINT_SCHEME_FORBIDDEN");
  }
  if (url.username !== "" || url.password !== "") {
    throw new McpEndpointRefusedError("MCP_ENDPOINT_CREDENTIALS_FORBIDDEN");
  }
  if (classifyAddress(url.hostname) === "blocked") {
    throw new McpEndpointRefusedError("MCP_ENDPOINT_HOST_NOT_PUBLIC");
  }
  return url;
}

/**
 * 第二道门：DNS 解析之后、连接之前，对每一个候选地址调用。没有 `not-an-ip` 的宽容分支：
 * 解析结果不是公网 IP 就是出了别的错，一律拒。
 */
export function assertResolvedMcpAddressAllowed(address: string): void {
  if (classifyAddress(address) !== "public") {
    throw new McpEndpointRefusedError("MCP_ENDPOINT_HOST_NOT_PUBLIC");
  }
}
