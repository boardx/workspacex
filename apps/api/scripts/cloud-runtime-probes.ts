import { auth } from "@repo/contracts";
import { ConfiguredModelProvider, readModelProviderConfig } from "../src/infrastructure/agent-run/configured-model-provider";
import { HttpSkillSandbox } from "../src/infrastructure/skill/http-skill-sandbox";

/** Session token stays in memory for subsequent authenticated probes, never in a report. */
export async function verifyCloudLogin(input: { publicUrl: string; email: string; password: string; orgId?: string; expectedDeploymentMarker?: string; signal: AbortSignal }, request: typeof fetch = fetch) {
  try {
    const base = new URL(input.publicUrl);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error();
    if (input.expectedDeploymentMarker) {
      const web = await request(new URL("/.well-known/workspacex-deployment", base), { signal: input.signal, redirect: "error", cache: "no-store" });
      if (!web.ok || (await web.json() as { deploymentMarker?: unknown }).deploymentMarker !== input.expectedDeploymentMarker) throw new Error();
    }
    const health = await request(new URL("/api/healthz", base), { signal: input.signal, redirect: "error" });
    if (!health.ok) throw new Error();
    const status = await health.json() as { trustworthy?: unknown; deploymentMarker?: unknown };
    if (status.trustworthy !== true || (input.expectedDeploymentMarker && status.deploymentMarker !== input.expectedDeploymentMarker)) throw new Error();
    const response = await request(new URL("/api/auth/login", base), { method: "POST", signal: input.signal, redirect: "error",
      headers: { "content-type": "application/json" }, body: JSON.stringify(auth.operations.login.in.parse({ email: input.email, password: input.password })) });
    if (!response.ok) throw new Error();
    const login = auth.operations.login.out.parse(await response.json());
    if (input.orgId) {
      if (!login.orgs.includes(input.orgId)) throw new Error();
      const switched = await request(new URL("/api/auth/switch-org", base), { method: "POST", signal: input.signal, redirect: "error",
        headers: { "content-type": "application/json", Authorization: `Bearer ${login.sessionToken}` },
        body: JSON.stringify(auth.operations.switchOrgAtLogin.in.parse({ toOrgId: input.orgId })) });
      if (!switched.ok || auth.operations.switchOrgAtLogin.out.parse(await switched.json()).org.id !== input.orgId) throw new Error();
    }
    return login;
  } catch { throw new Error("CLOUD_LOGIN_PROBE_FAILED"); }
}

/** Uses the same configured provider and offline sandbox transport as the application.
 * These component probes are supplementary; the end-to-end Agent run is checked separately.
 */
export async function verifyModelAndSandbox(env: NodeJS.ProcessEnv, signal: AbortSignal) {
  const config = readModelProviderConfig(env);
  const model = new ConfiguredModelProvider({ ...config, timeoutMs: Math.min(config.timeoutMs, 30_000) });
  try {
    if (!env.KERNEL_DEEP_AGENT_MODEL_ID || !env.KERNEL_SKILL_SANDBOX_SOCKET) throw new Error();
    const reply = await model.complete({ modelProvider: config.provider, modelId: env.KERNEL_DEEP_AGENT_MODEL_ID,
      system: "This is a deployment connectivity check. Reply with a short acknowledgement.", user: "Ready?", signal });
    if (!reply.text.trim()) throw new Error();
    if (signal.aborted) throw new Error();
    const sandbox = new HttpSkillSandbox({ socketPath: env.KERNEL_SKILL_SANDBOX_SOCKET, requestTimeoutMs: 10_000 });
    const result = await sandbox.run({ script: "process.stdout.write(String(2 + 2))", timeoutMs: 2000, signal });
    signal.throwIfAborted();
    if (result.exitCode !== 0 || result.timedOut || result.stdout.trim() !== "4") throw new Error();
    return { model: true, sandbox: true, agentBusinessVerified: false } as const;
  } catch { throw new Error("MODEL_OR_SANDBOX_PROBE_FAILED"); }
  finally { await model.close(); }
}
