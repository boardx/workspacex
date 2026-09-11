import { readFile } from "node:fs/promises";
import { z } from "zod";

// The API image copies this non-secret config from the Agent's single source.
// An info/health response cannot prove graphs are registered. Search each graph's
// default assistant without creating a thread or starting a run.
try {
  const budget = Number(process.env.PROVISION_TIMEOUT_MS);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 300000) throw new Error();
  const signal = AbortSignal.timeout(Math.min(10000, budget));
  const config = z.object({ graphs: z.record(z.string()).refine(value => Object.keys(value).length > 0) }).parse(
    JSON.parse(await readFile(new URL("../config/agent-graphs.json", import.meta.url), "utf8")));
  const [web, api] = await Promise.all([
    fetch("http://web:3000/", { signal, redirect: "error" }),
    fetch("http://api:3200/healthz", { signal, redirect: "error" }),
  ]);
  await web.body?.cancel();
  if (!web.ok || !api.ok) throw new Error();
  const status = await api.json() as { trustworthy?: unknown; deploymentMarker?: unknown };
  if (!process.env.WORKSPACEX_DEPLOYMENT_MARKER || status.trustworthy !== true || status.deploymentMarker !== process.env.WORKSPACEX_DEPLOYMENT_MARKER) throw new Error();
  const agent = process.env.KERNEL_DEEP_AGENT_BASE_URL;
  if (!agent) throw new Error();
  for (const graphId of Object.keys(config.graphs)) {
    const response = await fetch(`${agent.replace(/\/$/, "")}/assistants/search`, { method: "POST", signal, redirect: "error",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ graph_id: graphId, limit: 1, offset: 0, select: ["assistant_id", "graph_id"] }) });
    if (!response.ok) throw new Error();
    const assistants = z.array(z.object({ assistant_id: z.string().min(1), graph_id: z.string() })).parse(await response.json());
    if (!assistants.some(item => item.graph_id === graphId)) throw new Error();
  }
  signal.throwIfAborted();
  console.log(JSON.stringify({ ok: true, web: true, api: true, agentGraphs: true, businessVerified: false }));
} catch {
  console.error(JSON.stringify({ ok: false, reason: "cloud_services_not_ready" })); process.exitCode = 1;
}
