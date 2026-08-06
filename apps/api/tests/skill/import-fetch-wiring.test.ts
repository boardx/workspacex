/**
 * #595 —— 证的是**这条路径被保护了**，不是「那个函数正确」。
 *
 * ## 为什么单有 `import-source-guard.test.ts` 不够
 *
 * 那个文件把 `assertResolvedAddressAllowed` 测得很干净，还有三条反证。但它
 * **一个字都没说这道门被谁调用过**。第一版实现里它确实没有任何调用方——
 * 那种状态比没有门更坏：后来者看到「有校验 + 有测试 + 有反证」，会合理推断
 * SSRF 已经挡住了，**而它一次都没被调用**。反证证明的是「这个函数正确」，
 * 不是「这条路径被保护了」。
 *
 * ⇒ 本文件的反证是**摘掉调用点**（`http-import-fetcher.ts` 的 `guardedLookup`
 *   里那句 `checkAddress`），而不是摘掉函数。摘掉调用点后
 *   `import-source-guard.test.ts` **依然 18/18 全绿**，只有本文件会红。
 *   这就是两个文件必须都存在的理由。
 *
 * ## 校验点为什么必须在 `lookup` 里
 *
 * 「先查一次 DNS 校验，再交给 https 去连」有个经典缺口：https 会**自己再查一次**，
 * 第二次可以返回不同地址（DNS rebinding）。所以断言不只是「被拒了」，还包括
 * **socket 从未连上过测试服务器**（`connections === 0`）。只断言「抛错」的话，
 * 一个在解析前就乱抛的实现也会绿——那是今天本来就会绿的那种假门。
 *
 * ## TLS：用 test-only 自签证书 fixture，⛔ 不给生产开开关
 *
 * 取回层**强制 https**，所以「重定向逐跳过门」与「响应体上限」需要完成 TLS 握手
 * 才验得到。曾考虑把协议判定做成可注入——**否决**：那会在生产路径上造出一条
 * 能把 https 强制关掉的缝，而**一道能被绕过的门比没有门更坏，因为它看起来有**。
 *
 * ⇒ 改用 test-only 自签证书（**每次运行当场用 openssl 生成**，见 `tests/support/tls.ts`；
 *   ⚠ 曾写成「一次性生成并入库」，而 `.gitignore` 的 `*.pem` 让它根本没入过库 ⇒ CI 全红，
 *   ⛔ 不进任何生产路径）。取回层不接受 `agent` 参数，所以信任关系建立在
 *   `https.globalAgent.options.ca` 上，**并在 `afterAll` 还原**——
 *   生产代码**一行未改**，没有任何「关掉 https」的开关被造出来。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import {
  ImportSourceRefusedError,
  assertResolvedAddressAllowed,
} from "../../src/domain/skill/import-source";
import { MAX_BYTES, fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { testTlsMaterial } from "../support/tls";

const OPEN = { localOnlyOrg: false };

let server: http.Server;
let port = 0;
/** socket 是否真的连上来了——「被拒」必须发生在**连接之前**。 */
let connections = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => res.end("unused"));
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/**
 * 所有 DNS 都答成给定地址；不碰真实 DNS。
 *
 * ⚠ **实测**：`net.Socket` 调用 `lookup` 时传的是 `{hints, all: true}`，
 *   并期望回调收到**数组** `[{address, family}]`。回一个裸字符串会得到
 *   `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`，
 *   而且**连接根本不会发生**——正样本会以 `connections === 0` 假红。
 *   这一条只有跑一遍才撞得见，写在这里免得下一个人以为是门的问题。
 */
function resolveTo(address: string): ImportFetchSeams["lookup"] {
  const fn = (_host: string, opts: { all?: boolean } | undefined, cb: Function): void =>
    opts?.all === true ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
  return fn as unknown as ImportFetchSeams["lookup"];
}

/** 取回失败时 Node 会把我们的错误包成连接错误，所以要顺着 `cause` 找。 */
async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection, got success");
}

function refusalCodeOf(error: unknown): string | null {
  if (error instanceof ImportSourceRefusedError) return error.code;
  const cause = (error as { cause?: unknown })?.cause;
  return cause instanceof ImportSourceRefusedError ? cause.code : null;
}

describe("接线：DNS 解析后的那道门确实在取回路径上", () => {
  /**
   * 核心断言。域名在第一道门看起来是公网（`not-an-ip`），DNS 却答成云元数据地址。
   * ⚠ 用**生产默认**的 `assertResolvedAddressAllowed`，不是替身。
   */
  it("域名解析到 169.254.169.254 ⇒ 拒绝，且 socket 从未连上", async () => {
    connections = 0;
    const error = await caught(() =>
      fetchImportSource("https://metadata.example/skill.md", OPEN, {
        lookup: resolveTo("169.254.169.254"),
        checkAddress: assertResolvedAddressAllowed,
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
    expect(connections).toBe(0);
  });

  it("DNS rebinding 到 127.0.0.1 ⇒ 拒绝，且 socket 从未连上", async () => {
    connections = 0;
    const error = await caught(() =>
      fetchImportSource(`https://rebind.example:${port}/skill.md`, OPEN, {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: assertResolvedAddressAllowed,
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
    // ⚠ 这条尤其重要：端口指向的是**真实在监听**的测试服务器。
    //    如果这道门没接上，socket 会真的连上去，`connections` 就不是 0。
    expect(connections).toBe(0);
  });

  /**
   * 正样本，两件事一起证，缺一不可：
   *   ① 那道门**真的被调用了**，且拿到的是**解析后的地址**（不是域名）；
   *   ② 门放行时**连接真的会发生**（`connections > 0`）——证明上面两条的
   *      `connections === 0` 是门挡下来的，而不是这条路径本来就连不上。
   *
   * ⚠ 本条断言止步于「socket 连上了」：这台服务器是**明文**的，再往后握手必失败。
   *   「字节真的取回来了」由下面 TLS describe 里的正样本覆盖。
   */
  it("正样本：门放行 ⇒ 门被调用且连接真的发生（证明不是恒拒/恒不可达）", async () => {
    connections = 0;
    const seen: string[] = [];
    await caught(() =>
      fetchImportSource(`https://allowed.example:${port}/skill.md`, OPEN, {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: (address) => {
          seen.push(address); // 测试专用：放行 loopback，好让真实服务器可达
        },
      }),
    );
    expect(seen).toEqual(["127.0.0.1"]); // ① 门收到的是解析后的地址
    expect(connections).toBeGreaterThan(0); // ② 放行时确实连上了
  });

  it("personal-local 组织：取回层在任何 DNS 之前就拒", async () => {
    connections = 0;
    let looked = false;
    const error = await caught(() =>
      fetchImportSource("https://example.com/skill.md", { localOnlyOrg: true }, {
        lookup: ((_h: string, o: { all?: boolean } | undefined, cb: Function) => {
          looked = true;
          if (o?.all === true) cb(null, [{ address: "1.1.1.1", family: 4 }]);
          else cb(null, "1.1.1.1", 4);
        }) as unknown as ImportFetchSeams["lookup"],
        checkAddress: assertResolvedAddressAllowed,
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG");
    expect(looked).toBe(false); // 连 DNS 都不该查
    expect(connections).toBe(0);
  });
});

/**
 * 需要完成 TLS 握手才验得到的两条。用 test-only 自签证书，⛔ 生产路径零改动。
 */
describe("TLS 之后才验得到的：重定向逐跳过门 + 响应体上限", () => {
  let tls: https.Server;
  let tlsPort = 0;
  let tlsHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let savedCa: unknown;

  beforeAll(async () => {
    // ⚠ 当场生成，**不读入库文件**：`.gitignore` 有 `*.pem`，入库那条路走不通，
    //   而「本地有、CI 没有」正是 PR #600 那次 CI 红的根因。见 `tests/support/tls.ts`。
    const { cert, key } = testTlsMaterial();
    tls = https.createServer({ key, cert }, (req, res) => tlsHandler(req, res));
    await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve));
    tlsPort = (tls.address() as AddressInfo).port;
    // 只让**本测试进程**信任这份自签证书；afterAll 还原。
    savedCa = https.globalAgent.options.ca;
    https.globalAgent.options.ca = [cert];
  });
  afterAll(async () => {
    https.globalAgent.options.ca = savedCa as never;
    await new Promise<void>((resolve) => tls.close(() => resolve()));
  });

  /** 放行路径的完整正样本：字节真的取回来了。 */
  it("正样本：完整取回（证明 TLS 装置本身是好的）", async () => {
    tlsHandler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      res.end("# SKILL\n");
    };
    const fetched = await fetchImportSource(`https://allowed.example:${tlsPort}/skill.md`, OPEN, {
      lookup: resolveTo("127.0.0.1"),
      checkAddress: () => {},
    });
    expect(fetched.body.toString()).toBe("# SKILL\n");
    expect(fetched.mediaType).toBe("text/markdown");
  });

  /**
   * 重定向必须**每一跳重新过门**：`https://good` 可以 302 到 `169.254.169.254`。
   * ⚠ 这一跳被**字面量门**拦下，用的是生产判定。
   */
  it("302 到云元数据地址 ⇒ 在第二跳被拒（每跳都过门）", async () => {
    tlsHandler = (req, res) => {
      if (req.url === "/skill.md") {
        res.writeHead(302, { location: "https://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("SECRET");
    };
    const error = await caught(() =>
      fetchImportSource(`https://allowed.example:${tlsPort}/skill.md`, OPEN, {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: () => {},
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
  });

  it("302 到 http:// ⇒ 被拒（重定向不能把 https 降级掉）", async () => {
    tlsHandler = (_req, res) => {
      res.writeHead(302, { location: "http://allowed.example/plain" });
      res.end();
    };
    const error = await caught(() =>
      fetchImportSource(`https://allowed.example:${tlsPort}/skill.md`, OPEN, {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: () => {},
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_URL_SCHEME_FORBIDDEN");
  });

  it("响应体超上限 ⇒ IMPORT_PAYLOAD_TOO_LARGE", async () => {
    tlsHandler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.alloc(MAX_BYTES + 4096));
    };
    const error = await caught(() =>
      fetchImportSource(`https://big.example:${tlsPort}/big.bin`, OPEN, {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: () => {},
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_PAYLOAD_TOO_LARGE");
  });

  it("重定向次数超上限 ⇒ IMPORT_TOO_MANY_REDIRECTS", async () => {
    tlsHandler = (_req, res) => {
      res.writeHead(302, { location: `https://allowed.example:${tlsPort}/loop` });
      res.end();
    };
    const error = await caught(() =>
      fetchImportSource(`https://allowed.example:${tlsPort}/loop`, OPEN, {
        lookup: resolveTo("127.0.0.1"),
        checkAddress: () => {},
      }),
    );
    expect(refusalCodeOf(error)).toBe("IMPORT_TOO_MANY_REDIRECTS");
  });
});
