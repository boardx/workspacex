/**
 * issue #2645 —— `ServiceUptimeProbe` 的 HTTP 实现:GET 目标 URL,2xx/3xx 记可用,
 * 其它一律记不可用（超时、网络错误、4xx/5xx）。
 *
 * ⚠ 目标 URL 来自部署环境变量（`DEV_APP_UPTIME_URL`）,是运维配置,不是用户输入——
 *   与 `infrastructure/mcp/guarded-fetch.ts` 要挡的"调用方可控目标"场景不同,这里
 *   不需要那一层 DNS-rebinding 防护,直接用平台 `fetch` 即可,同
 *   `CloudflareTransactionalEmailTransport` 的既有先例（那个 token/目标也来自环境变量）。
 */
import type { ServiceUptimeProbe, ServiceUptimeProbeResult } from "../../application/system/uptime-ports";

export class HttpServiceUptimeProbe implements ServiceUptimeProbe {
  constructor(private readonly request: typeof fetch = fetch) {}

  async check(url: string, timeoutMs: number): Promise<ServiceUptimeProbeResult> {
    const startedAt = Date.now();
    try {
      const response = await this.request(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { isUp: false, latencyMs, error: `http_${response.status}` };
      }
      return { isUp: true, latencyMs, error: null };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? (err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : err.message) : String(err);
      return { isUp: false, latencyMs, error: message.slice(0, 500) };
    }
  }
}
