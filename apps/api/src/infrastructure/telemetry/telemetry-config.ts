/**
 * D9 上报方的部署配置——两个环境变量名的**单点**（契约 `TelemetryReporterState` 头注引用本文件）。
 *
 * - `WSX_TELEMETRY_ENDPOINT`：上报地址（https URL）。未设 / 不合法 ⇒ 整个上报关闭，启动时记一次日志。
 * - `WSX_TELEMETRY_DISABLED`：全局总开关，`1` / `true` ⇒ 整个上报关闭，不论同意项与地址。
 * - `WSX_PRODUCT_VERSION`：可选，镜像构建时注入的发行版号（x.y.z）；未设则读 `apps/api/package.json` 的 version。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TelemetryConfig } from "../../application/telemetry/telemetry-ports";

export const TELEMETRY_ENDPOINT_ENV = "WSX_TELEMETRY_ENDPOINT";
export const TELEMETRY_KILL_SWITCH_ENV = "WSX_TELEMETRY_DISABLED";
export const PRODUCT_VERSION_ENV = "WSX_PRODUCT_VERSION";
/** 短超时：上报不许拖住实例。 */
export const TELEMETRY_SEND_TIMEOUT_MS = 5_000;

export { TELEMETRY_CONFIG, type TelemetryConfig } from "../../application/telemetry/telemetry-ports";

function parseEndpoint(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function packageVersion(): string {
  try {
    const p = fileURLToPath(new URL("../../../package.json", import.meta.url));
    const v = (JSON.parse(readFileSync(p, "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function readTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const kill = (env[TELEMETRY_KILL_SWITCH_ENV] ?? "").trim().toLowerCase();
  const v = (env[PRODUCT_VERSION_ENV] ?? "").trim();
  return {
    endpoint: parseEndpoint(env[TELEMETRY_ENDPOINT_ENV]),
    killSwitch: kill === "1" || kill === "true",
    timeoutMs: TELEMETRY_SEND_TIMEOUT_MS,
    productVersion: /^\d+\.\d+\.\d+$/.test(v) ? v : packageVersion(),
  };
}
