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
  /**
   * 额外信任的 CA（PEM）。⚠ 这**不是**安全旁路——生产场景本来就存在"组织自建 MCP 服务器
   * 挂了内部签发的证书"这种正当需求；对测试而言，它是让 `http-mcp-gateway-real-protocol.test.ts`
   * 能对着 `tests/support/tls.ts` 的 test-only 自签证书完成真实 TLS 握手的手段，
   * 与 `http-import-fetcher.ts` 测试里"信任关系建立在 https.globalAgent.options.ca 上"
   * 是同一件事的 undici 版本——那边改的是全局 agent，这里通过显式选项传，因为
   * 本文件的 `Agent` 从不使用全局 dispatcher。
   */
  readonly extraTrustedCa?: string | Buffer;
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
      ...(options.extraTrustedCa !== undefined ? { ca: options.extraTrustedCa } : {}),
    },
    bodyTimeout: options.connectTimeoutMs,
    headersTimeout: options.connectTimeoutMs,
  });

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const merged: Record<string, unknown> = { ...(init as Record<string, unknown> | undefined) };
    merged.redirect = "error";
    merged.dispatcher = agent;
    /**
     * ⚠ **不能只靠 `Agent` 的 `connect.timeout`/`bodyTimeout`/`headersTimeout`**——实测
     *   （vitest 的 worker 池环境，`http-mcp-gateway-real-protocol.test.ts` 的超时用例）：
     *   同一段代码在裸 `tsx` 下几百毫秒内如期触发，在 vitest 的 worker 线程里却真的挂到
     *   vitest 自己的 10s 测试超时——undici 的连接层定时器在该环境下没有如期触发。
     *   这里显式叠一层 `AbortSignal.timeout`，不依赖 dispatcher 内部计时器，是"答内 Nms
     *   或明确失败"（UC-21.1 R9）唯一在两种运行环境下都验证过确实生效的手段。
     */
    const deadline = AbortSignal.timeout(options.connectTimeoutMs);
    const callerSignal = (init as { signal?: AbortSignal } | undefined)?.signal;
    merged.signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    return undiciFetch(input as never, merged as never) as unknown as Promise<Response>;
  }) as typeof fetch;
}
