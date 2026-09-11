import type { DeploymentConfig } from "./config";

type ProbeContext = { signal: AbortSignal; remainingMs: () => number };
const metadata = "http://100.100.100.200/latest";

async function boundedText(response: Response, limit = 4096): Promise<string> {
  if (!response.ok || !response.body) throw new Error("PROBE_FAILED");
  const reader = response.body.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new Error("PROBE_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel(); }
}

/** ECS IMDSv2 only. No insecure-v1 fallback, no metadata token/credentials in reports.
 * Source: Alibaba Cloud ECS 'View instance metadata'. This verifies the execution target,
 * not RDS/Redis resource class, backup policy or ownership of unrelated resources.
 */
export async function verifyEcsIdentity(config: DeploymentConfig, context: ProbeContext, request: typeof fetch = fetch) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, Math.min(5000, Math.floor(context.remainingMs()))))]);
  try {
    if (context.signal.aborted || context.remainingMs() <= 0) throw new Error();
    const token = (await boundedText(await request(`${metadata}/api/token`, { method: "PUT", redirect: "error", signal,
      headers: { "X-aliyun-ecs-metadata-token-ttl-seconds": "60" } }))).trim();
    if (!token || /[\r\n\0]/.test(token)) throw new Error();
    const headers = { "X-aliyun-ecs-metadata-token": token };
    const values = await Promise.all(["instance-id", "region-id", "ram/security-credentials/"].map(async name =>
      (await boundedText(await request(`${metadata}/meta-data/${name}`, { headers, signal, redirect: "error" }))).trim()));
    if (values[0] !== config.environment.ecsInstanceId || values[1] !== config.environment.regionId ||
      !values[2]!.split(/\s+/).includes(config.environment.runtimeRole)) throw new Error();
    return { instanceMatched: true, regionMatched: true, roleMatched: true } as const;
  } catch { throw new Error("ECS_IDENTITY_PREFLIGHT_FAILED"); }
}

/** Check TLS/DNS transport without requiring the application to have started in prepare.
 * A 404 is acceptable here: application/business readiness is a separate timed stage.
 */
export async function verifyHttpsEndpoint(url: string, context: ProbeContext, request: typeof fetch = fetch): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || context.remainingMs() <= 0) throw new Error();
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, Math.min(5000, Math.floor(context.remainingMs()))))]);
    const response = await request(parsed, { method: "HEAD", redirect: "error", signal });
    await response.body?.cancel();
    if (response.status < 200 || response.status >= 500 || (response.status >= 300 && response.status < 400)) throw new Error();
  } catch { throw new Error("HTTPS_PREFLIGHT_FAILED"); }
}

export function requireComposeVersion(value: string): void {
  const version = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 30)) {
    throw new Error("COMPOSE_2_30_REQUIRED");
  }
}
