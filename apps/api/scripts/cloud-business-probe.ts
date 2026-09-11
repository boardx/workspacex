import { verifyCloudLogin, verifyModelAndSandbox } from "./cloud-runtime-probes";
import { verifyCloudFileRoundtrip } from "./cloud-file-roundtrip";
import { verifyCloudAgentRoundtrip } from "./cloud-agent-roundtrip";

// Executed in the release API image with only the private probe env file. No tokens,
// passwords, prompts or replies are written to stdout, including on failures.
let remoteCleanupUnproven = false;
try {
  const budget = Number(process.env.PROVISION_TIMEOUT_MS);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 300000) throw new Error();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(budget), cancellation.signal]);
  const publicUrl = process.env.PROVISION_PUBLIC_URL!;
  const orgId = process.env.PROVISION_ORG_ID!;
  const agentId = process.env.PROVISION_DEFAULT_AGENT_ID!;
  const expectedDeploymentMarker = process.env.WORKSPACEX_DEPLOYMENT_MARKER;
  if (!orgId || !agentId || !expectedDeploymentMarker) throw new Error();
  const login = await verifyCloudLogin({ publicUrl, orgId, email: process.env.PROVISION_ADMIN_EMAIL!,
    password: process.env.PROVISION_ADMIN_PASSWORD!, expectedDeploymentMarker, signal });
  const baseUrl = `${publicUrl.replace(/\/$/, "")}/api`;
  const work = [
    verifyCloudFileRoundtrip(baseUrl, login.sessionToken, orgId, signal),
    verifyCloudAgentRoundtrip({ baseUrl, session: login.sessionToken, signal, agentId }),
    verifyModelAndSandbox(process.env, signal),
  ] as const;
  let results: [Awaited<typeof work[0]>, Awaited<typeof work[1]>, Awaited<typeof work[2]>];
  try { results = await Promise.all(work); }
  catch {
    remoteCleanupUnproven = true;
    cancellation.abort();
    await Promise.allSettled(work);
    throw new Error();
  }
  const [file, agent, components] = results;
  signal.throwIfAborted();
  console.log(JSON.stringify({ ok: true, loginVerified: true, file, agent, components }));
} catch {
  console.error(JSON.stringify({ ok: false, reason: "cloud_business_probe_failed" }));
  process.exitCode = remoteCleanupUnproven ? 79 : 1;
}
