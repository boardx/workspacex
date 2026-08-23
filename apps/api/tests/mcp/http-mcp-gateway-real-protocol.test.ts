/**
 * issue #1849 —— `createHttpMcpGateway` 对着一个**真实**的 MCP HTTP/SSE 服务器
 * （官方 SDK `McpServer` + `StreamableHTTPServerTransport`，见 `support/local-mcp-http-server.ts`）
 * 完成一次真正的协议握手 + `tools/list`。
 *
 * ⚠ 这条测试证的是"我们的 client 配置真的说得对 MCP 协议"，不是在测 SDK 自己——
 * 服务端也是同一个 SDK 起的，但我们的 `guarded-fetch.ts` / transport 选项 / 错误映射
 * 全部是本仓代码，一个手写假桩会漏掉"这些选项拼在一起真的能握手"这件事。
 *
 * ⚠ SSRF 反证与 `import-fetch-wiring.test.ts` 同一条纪律：字面量域名 + DNS seam 解析到
 *   127.0.0.1，`connections` 计数器证明"门放行时才连、门拒绝时从未连"，而不是恒拒/恒可达。
 */
import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import https from "node:https";
import dns from "node:dns";
import {
  createHttpMcpGateway,
  DEFAULT_MCP_DISCOVERY_TIMEOUT_MS,
} from "../../src/infrastructure/mcp/http-mcp-gateway";
import { assertResolvedMcpAddressAllowed } from "../../src/domain/mcp/remote-endpoint-guard";
import { McpDiscoveryTimeoutError, McpServerUnreachableError } from "../../src/application/mcp/ports";
import { startLocalMcpHttpServer, type LocalMcpHttpServer } from "./support/local-mcp-http-server";
import { testTlsMaterial } from "../support/tls";

const OPEN = { localOnlyOrg: false };

/** 所有 DNS 都答成给定地址；不碰真实 DNS——与 `import-fetch-wiring.test.ts` 同一份配方。 */
function resolveTo(address: string): typeof dns.lookup {
  const fn = (_host: string, opts: { all?: boolean } | undefined, cb: Function): void =>
    opts?.all === true ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
  return fn as unknown as typeof dns.lookup;
}

let fixture: LocalMcpHttpServer | null = null;
let connections = 0;

afterEach(async () => {
  if (fixture) {
    await fixture.close();
    fixture = null;
  }
  connections = 0;
});

describe("真实协议：tools/list 拿到真实工具，annotations 决定 sideEffect", () => {
  it("readOnlyHint:true 的工具归为「只读」；没有 annotations 的工具保守归为「写入外部」", async () => {
    fixture = await startLocalMcpHttpServer("allowed.example");

    const gateway = createHttpMcpGateway({
      credential: null,
      policy: OPEN,
      extraTrustedCa: testTlsMaterial().cert,
      seams: {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: () => {}, // 测试专用：放行 loopback，好让真实服务器可达
      },
    });

    const tools = await gateway.listTools("s-fixture", fixture.url);

    expect(tools).toHaveLength(2);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("query_contact")?.sideEffect).toBe("只读");
    expect(byName.get("create_task")?.sideEffect).toBe("写入外部");
    // 签名里带上了参数名，供 discover-tools 的指纹比对使用。
    expect(byName.get("query_contact")?.signature).toContain("company");
    expect(byName.get("create_task")?.signature).toContain("title");
  });

  it("Bearer 凭据真的作为 Authorization 头发出去（服务端能读到）", async () => {
    // MCP 协议本身不校验凭据，这里只证明 header 真的被发送出去，没有在 client 侧被吞掉——
    // 用一个会记录收到的 header 的裸 https server（不需要真的说 MCP 协议）。
    let seenAuth: string | undefined;
    const material = testTlsMaterial();
    const server = https.createServer({ cert: material.cert, key: material.key }, (req, res) => {
      seenAuth = req.headers.authorization;
      res.writeHead(503).end(); // 内容不重要，只要 header 被看到就够了
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    const gateway = createHttpMcpGateway({
      credential: "secret-token-123",
      policy: OPEN,
      extraTrustedCa: material.cert,
      timeoutMs: 3000,
      seams: { lookup: resolveTo("127.0.0.1"), checkAddress: () => {} },
    });

    await gateway.listTools("s-auth", `https://redirect.example:${port}/mcp`).catch(() => {
      // 503 会让协议握手失败并抛 McpServerUnreachableError——我们只关心 header 是否发出。
    });

    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    expect(seenAuth).toBe("Bearer secret-token-123");
  });
});

describe("SSRF 第二道门接线：DNS 解析后拒绝，且 socket 从未连上真实服务器", () => {
  it("域名字面量看起来公网，DNS 却解析到 127.0.0.1 ⇒ McpServerUnreachableError，且从未连接", async () => {
    fixture = await startLocalMcpHttpServer("rebind.example");

    // 用真实生产门（`assertResolvedMcpAddressAllowed`）而不是替身。
    const gateway = createHttpMcpGateway({
      credential: null,
      policy: OPEN,
      extraTrustedCa: testTlsMaterial().cert,
      seams: { lookup: resolveTo("127.0.0.1"), checkAddress: assertResolvedMcpAddressAllowed },
    });

    await expect(gateway.listTools("s-rebind", fixture.url)).rejects.toBeInstanceOf(
      McpServerUnreachableError,
    );
    expect(fixture.connectionCount()).toBe(0);
  });

  it("字面量就是 IP（127.0.0.1）⇒ 第一道门直接拒绝，连 DNS 都不查、socket 从未连接", async () => {
    let sawConnection = false;
    const raw = net.createServer((socket) => {
      sawConnection = true;
      socket.destroy();
    });
    await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
    const port = (raw.address() as net.AddressInfo).port;

    const gateway = createHttpMcpGateway({ credential: null, policy: OPEN });
    await expect(
      gateway.listTools("s-literal", `https://127.0.0.1:${port}/mcp`),
    ).rejects.toBeInstanceOf(McpServerUnreachableError);

    await new Promise<void>((resolve, reject) => raw.close((err) => (err ? reject(err) : resolve())));
    expect(sawConnection).toBe(false);
  });
});

describe("超时：UC-21.1 R9——答内 10s 或明确失败，绝不挂起", () => {
  it("连接被接受但服务器从不完成 TLS 握手 ⇒ McpDiscoveryTimeoutError（不是无限等待）", async () => {
    const openSockets = new Set<net.Socket>();
    const hang = net.createServer((socket) => {
      // 接受 TCP 连接，但从不发送任何字节——TLS 握手永远卡在这里。
      connections += 1;
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });
    await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
    const port = (hang.address() as net.AddressInfo).port;

    const gateway = createHttpMcpGateway({
      credential: null,
      policy: OPEN,
      timeoutMs: 200, // 远小于默认的 10s，测试不用真的等 10 秒
      seams: { lookup: resolveTo("127.0.0.1"), checkAddress: () => {} },
    });

    await expect(
      gateway.listTools("s-hang", `https://allowed.example:${port}/mcp`),
    ).rejects.toBeInstanceOf(McpDiscoveryTimeoutError);
    expect(connections).toBeGreaterThan(0); // 证明真的连上了、是握手阶段卡住，不是提前拒绝

    // ⚠ 这台服务器故意从不主动关闭连接（那正是它在测的场景）——`server.close()` 的回调
    //   只有在所有已接受的连接都结束后才会触发；不主动销毁这些"沉默"的 socket，
    //   `hang.close()` 会自己也悬着不返回，把测试挂到 vitest 的用例超时（曾经真的这样炸过）。
    for (const socket of openSockets) socket.destroy();
    await new Promise<void>((resolve, reject) => hang.close((err) => (err ? reject(err) : resolve())));
  }, 10_000);

  it("默认超时是 10s（UC-21.1 R9 的具体数字，不是随便选的）", () => {
    expect(DEFAULT_MCP_DISCOVERY_TIMEOUT_MS).toBe(10_000);
  });
});
