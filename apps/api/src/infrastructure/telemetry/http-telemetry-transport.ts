/** D9 —— 出站 POST，一次，短超时；任何失败都返回 `{ ok: false }`，不抛、不重试。 */
import type { TelemetryTransport } from "../../application/telemetry/telemetry-ports";

export class HttpTelemetryTransport implements TelemetryTransport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async post(endpoint: string, body: string, timeoutMs: number, installSecret: string): Promise<{ ok: boolean }> {
    try {
      const res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${installSecret}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }
}
