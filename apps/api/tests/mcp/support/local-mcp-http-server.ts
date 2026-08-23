/**
 * issue #1849 —— **测试专用**的真实 MCP HTTP/SSE 服务器 fixture。
 *
 * ⚠ 这不是运行时会启动的东西——它是测试基础设施，用来验证
 * `infrastructure/mcp/http-mcp-gateway.ts` 真的说得对 MCP 协议（用官方 SDK 的
 * `McpServer` + `StreamableHTTPServerTransport` 起一个真实服务器，而不是对着一个手写的
 * HTTP 假桩断言）。找不到一个稳定可用的公开 MCP HTTP server 供集成测试使用，所以选择
 * 本地起一个真实协议实现的服务器——两端都是官方 SDK，验证的是"我们的 client 配置
 * （guarded fetch / transport 选项）与真实协议握手兼容"，不是在验证 SDK 自己。
 *
 * ⚠ **无状态模式下，每个 HTTP 请求都要一个全新的 `StreamableHTTPServerTransport`
 *   （与一个全新连接它的 `McpServer`）**——这不是本文件的选择，是 SDK 自己的不变量：
 *   `webStandardStreamableHttp.js` 的 `handleRequest` 第二个请求起就会抛
 *   `"Stateless transport cannot be reused across requests. Create a new transport per
 *   request."`，且这个错误经由 `@hono/node-server` 的 `handleFetchError` **被吞成裸 500**，
 *   不会经过 `transport.handleRequest(...).catch(...)` 冒泡出来——实测撞过一次
 *   （第一个请求成功握手，第二个请求即 `notifications/initialized` 通知，原地 500，
 *   排查靠临时打进 SDK 源码的 debug print 才找到，而不是任何异常栈）。
 */
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { testTlsMaterial } from "../../support/tls";

export interface LocalMcpHttpServer {
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  /** 有多少个 TCP 连接真的到达过这台服务器——SSRF 反证要证明"门放行时才连"。 */
  connectionCount(): number;
  close(): Promise<void>;
}

/** 一台服务器只注册一次的工具定义，每个请求的新 `McpServer` 都重新挂上同一份定义。 */
function registerTestTools(mcp: McpServer): void {
  mcp.registerTool(
    "query_contact",
    {
      description: "只读查询联系人",
      inputSchema: { company: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ company }) => ({
      content: [{ type: "text", text: `queried ${company ?? "all"}` }],
    }),
  );

  mcp.registerTool(
    "create_task",
    {
      description: "没有标注的工具——不能被当成只读",
      inputSchema: { title: z.string() },
    },
    async ({ title }) => ({
      content: [{ type: "text", text: `created ${title}` }],
    }),
  );
}

/**
 * 起一台真实的 MCP HTTP server，注册两个工具：一个显式标 `readOnlyHint: true`
 * （用于验证 `sideEffectOf` 把它归到「只读」），一个不带任何 `annotations`
 * （用于验证保守默认——没有标注就不当只读，见 `http-mcp-gateway.ts` 头注）。
 *
 * @param hostname 用于 TLS SNI/证书校验的主机名——必须是
 *   `tests/support/tls/openssl.cnf` 里 `subjectAltName` 列出的名字之一，
 *   实际监听地址仍然是 `127.0.0.1`（由调用方的 DNS seam 把该主机名解析过去）。
 */
export async function startLocalMcpHttpServer(hostname: string): Promise<LocalMcpHttpServer> {
  const tls = testTlsMaterial();
  const server = https.createServer({ cert: tls.cert, key: tls.key }, (req, res) => {
    // 无状态模式的不变量（见文件头注）：新的 McpServer + 新的 transport，每个请求各一份。
    const mcp = new McpServer({ name: "workspacex-test-mcp-server", version: "1.0.0" });
    registerTestTools(mcp);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    mcp
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" }).end(
            JSON.stringify({ error: "test fixture failure", detail: String(err) }),
          );
        }
      });
  });

  let connections = 0;
  server.on("connection", (socket: Socket) => {
    connections += 1;
    void socket;
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `https://${hostname}:${port}/mcp`,
    hostname,
    port,
    connectionCount: () => connections,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
