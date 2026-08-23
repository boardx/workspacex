/**
 * issue #1852 —— `domain/mcp/remote-endpoint-guard.ts` 的字面量门。
 * 每一组都带反证：一个必须通过的输入，紧挨着必须拒绝的输入，防止空转成"总是拒绝也绿"。
 */
import { describe, expect, it } from "vitest";
import {
  McpEndpointRefusedError,
  assertMcpEndpointAllowed,
  assertResolvedMcpAddressAllowed,
} from "../../src/domain/mcp/remote-endpoint-guard";

const OPEN = { localOnlyOrg: false };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof McpEndpointRefusedError) return error.code;
    throw error;
  }
  throw new Error("expected a throw");
}

describe("assertMcpEndpointAllowed：字面量门", () => {
  it("正样本：合法的公网 https URL 通过，且规范化返回 URL", () => {
    const url = assertMcpEndpointAllowed("https://mcp.example.com/sse", OPEN);
    expect(url.hostname).toBe("mcp.example.com");
  });

  it("http 明文 ⇒ MCP_ENDPOINT_SCHEME_FORBIDDEN", () => {
    expect(codeOf(() => assertMcpEndpointAllowed("http://mcp.example.com/sse", OPEN))).toBe(
      "MCP_ENDPOINT_SCHEME_FORBIDDEN",
    );
  });

  it("stdio 之类的非 http(s) scheme ⇒ MCP_ENDPOINT_SCHEME_FORBIDDEN（本轮不做本地子进程）", () => {
    expect(codeOf(() => assertMcpEndpointAllowed("stdio://some-command", OPEN))).toBe(
      "MCP_ENDPOINT_SCHEME_FORBIDDEN",
    );
  });

  it("不是合法 URL ⇒ MCP_ENDPOINT_MALFORMED", () => {
    expect(codeOf(() => assertMcpEndpointAllowed("not a url", OPEN))).toBe("MCP_ENDPOINT_MALFORMED");
  });

  it("URL 内嵌凭据 ⇒ MCP_ENDPOINT_CREDENTIALS_FORBIDDEN（凭据走独立字段）", () => {
    expect(
      codeOf(() => assertMcpEndpointAllowed("https://user:pw@mcp.example.com/sse", OPEN)),
    ).toBe("MCP_ENDPOINT_CREDENTIALS_FORBIDDEN");
  });

  it("字面量就是私网/loopback/云元数据 ⇒ MCP_ENDPOINT_HOST_NOT_PUBLIC", () => {
    expect(codeOf(() => assertMcpEndpointAllowed("https://127.0.0.1/sse", OPEN))).toBe(
      "MCP_ENDPOINT_HOST_NOT_PUBLIC",
    );
    expect(codeOf(() => assertMcpEndpointAllowed("https://169.254.169.254/sse", OPEN))).toBe(
      "MCP_ENDPOINT_HOST_NOT_PUBLIC",
    );
    expect(codeOf(() => assertMcpEndpointAllowed("https://10.0.0.5/sse", OPEN))).toBe(
      "MCP_ENDPOINT_HOST_NOT_PUBLIC",
    );
  });

  it("personal-local 组织 ⇒ 一律拒绝，且先于其它任何判定（I-9）", () => {
    expect(
      codeOf(() => assertMcpEndpointAllowed("https://mcp.example.com/sse", { localOnlyOrg: true })),
    ).toBe("MCP_ENDPOINT_FORBIDDEN_FOR_LOCAL_ORG");
  });
});

describe("assertResolvedMcpAddressAllowed：DNS 解析后的第二道门", () => {
  it("正样本：公网地址通过（不抛）", () => {
    expect(() => assertResolvedMcpAddressAllowed("93.184.216.34")).not.toThrow();
  });

  it("反证：字面量是域名会被这道门放过的地址，解析后仍要被拦——169.254.169.254 拒绝", () => {
    expect(codeOf(() => assertResolvedMcpAddressAllowed("169.254.169.254"))).toBe(
      "MCP_ENDPOINT_HOST_NOT_PUBLIC",
    );
  });

  it("IPv4-mapped IPv6 形式的 loopback 一样被拒（实测：hostname 会被折成十六进制组）", () => {
    expect(codeOf(() => assertResolvedMcpAddressAllowed("::ffff:127.0.0.1"))).toBe(
      "MCP_ENDPOINT_HOST_NOT_PUBLIC",
    );
  });
});
