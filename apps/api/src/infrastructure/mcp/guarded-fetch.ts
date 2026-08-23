/**
 * issue #1849 —— 出站取回层，也就是 SSRF 第二道门（DNS 解析后）**唯一的调用点**。
 *
 * 与 `infrastructure/skill/http-import-fetcher.ts` 同一条纪律（该文件头注详细写明理由，
 * 这里不重复）：字面量校验（`assertMcpEndpointAllowed`）挡不住 DNS rebinding——
 * `https://good.example/` 解析出来完全可能是 `169.254.169.254`。校验必须发生在**连接真正
 * 使用的那一次解析**上，也就是这里传给 `undici.Agent` 的自定义 `connect.lookup`。
 *
 * ## 为什么是 undici 的 `Agent` 而不是照抄 `https.request({ lookup })`
 *
 * MCP TypeScript SDK 的 `StreamableHTTPClientTransport` 接的是一个 `fetch`-形状的函数
 * （`FetchLike`），不是 Node 的 `https.request`。undici 的 `Agent` 允许在 `connect` 选项里
 * 塞一个自定义 `lookup`——它一路透传到 `tls.connect(options)`，而 `tls.connect` 与
 * `net.connect` 一样接受 `lookup` 选项（Node 文档）。这就是 fetch 版本的
 * "地址进 socket 之前的最后一道关"。
 *
 * ⚠ `redirect: "error"`——MCP Streamable HTTP 协议不需要重定向；与其对每一跳重新走两道门
 *   （`http-import-fetcher.ts` 那样做是因为 skill 导入的取回目标本来就可能带重定向），
 *   这里选择更简单也更安全的选项：出现重定向直接判失败，不跟随。
 */
import { Agent, fetch as undiciFetch } from "undici";
import dns from "node:dns";
import { assertResolvedMcpAddressAllowed } from "../../domain/mcp/remote-endpoint-guard";

/** 测试接缝——只有两个，且都不是"跳过校验"，与 `ImportFetchSeams` 同一形状。 */
export interface GuardedFetchSeams {
  readonly lookup: typeof dns.lookup;
  readonly checkAddress: (address: string) => void;
}

const PRODUCTION_SEAMS: GuardedFetchSeams = {
  lookup: dns.lookup,
  checkAddress: assertResolvedMcpAddressAllowed,
};

/** 抛出时携带者可判定"这是一次 SSRF 拒绝"，与业务性的连接失败区分开。 */
export class GuardedFetchRefusedError extends Error {
  constructor(readonly detail: string) {
    super(`guarded fetch refused: ${detail}`);
    this.name = "GuardedFetchRefusedError";
  }
}

function guardedLookup(seams: GuardedFetchSeams): typeof dns.lookup {
  const wrapped = (
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
  ): void => {
    seams.lookup(hostname, options as dns.LookupOptions, (err, address, family) => {
      if (err) {
        callback(err);
        return;
      }
      const candidates = Array.isArray(address)
        ? address.map((entry) => entry.address)
        : [String(address)];
      try {
        for (const candidate of candidates) seams.checkAddress(candidate);
      } catch (refusal) {
        callback(new GuardedFetchRefusedError(String((refusal as Error).message)));
        return;
      }
      callback(null, address, family);
    });
  };
  return wrapped as unknown as typeof dns.lookup;
}

export interface GuardedFetchOptions {
  /** 单次连接的超时（毫秒）——UC-21.1 R9："答内 10s 或明确失败，绝不挂起"。 */
  readonly connectTimeoutMs: number;
  readonly seams?: GuardedFetchSeams;
}

/**
 * 造一个"打过两道门"的 `fetch`。⚠ 这就是接线本身——摘掉这里对 `checkAddress` 的调用，
 * `assertResolvedMcpAddressAllowed` 的所有单测依然全绿，正是端到端反证要证的事
 * （与 `http-import-fetcher.ts` 头注逐字同一条纪律）。
 */
export function createGuardedFetch(options: GuardedFetchOptions): typeof fetch {
  const seams = options.seams ?? PRODUCTION_SEAMS;
  const agent = new Agent({
    connect: {
      lookup: guardedLookup(seams),
      timeout: options.connectTimeoutMs,
    },
    bodyTimeout: options.connectTimeoutMs,
    headersTimeout: options.connectTimeoutMs,
  });

  return (async (input: string | URL | Request, init?: RequestInit) => {
    return undiciFetch(input as never, {
      ...(init as never),
      redirect: "error",
      dispatcher: agent as never,
    } as never) as unknown as Promise<Response>;
  }) as typeof fetch;
}
