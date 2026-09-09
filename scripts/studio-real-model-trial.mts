/** Explicitly selected model credentials go only to API/deep-agent children; no devapp auth bypass. */
import { spawn, execFileSync } from "node:child_process";
import { createServer as createNetServer, type Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStudioIsolation } from "./studio-skill-files-guards.ts";
import { ExecutionEvent } from "../packages/contracts/src/execution-journal.ts";
import type { RunProjection } from "../apps/api/src/application/agent-run/ports.ts";
import { DEV_MODE_ACCOUNTS } from "../packages/dev-mode-accounts/src/index.ts";
import { skillFileEdit, skills, wave2Runtime, agentRuntime, chat } from "../packages/contracts/src/index.ts";

assertStudioIsolation();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const scriptDigest = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
const evidence = await mkdtemp(join(tmpdir(), `studio-real-model-${process.env.COMPOSE_PROJECT_NAME}-`));
const modelVars: Record<string, string> = {};
const source = await readFile(process.env.STUDIO_MODEL_ENV_FILE ?? join(root, ".env.local"), "utf8");
for (const line of source.split(/\r?\n/)) {
  const match = /^(?:export\s+)?(DASHSCOPE_API_KEY|DASHSCOPE_BASE_URL|DASHSCOPE_MODEL)\s*=\s*(.*)$/.exec(line.trim());
  if (match) modelVars[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
}
for (const name of ["DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "DASHSCOPE_MODEL"]) if (!modelVars[name]) throw new Error(`Missing ${name}`);
const inheritedEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|CREDENTIAL|PASSWORD|PRIVATE_KEY)/i.test(name) && !/^(?:DASHSCOPE|OPENAI|ANTHROPIC|AZURE_OPENAI|GEMINI|GOOGLE_AI|GROQ|MISTRAL|COHERE|DEEPSEEK|LANGSMITH|LANGCHAIN|KERNEL_MODEL)_/.test(name)));
const baseEnv = { ...inheritedEnv, WORKSPACEX_DEV_MODE: "1", NODE_ENV: "development", KERNEL_ALLOW_TEST_PRINCIPAL: "0", KERNEL_AGENT_RUN_AUTOSTART: "0", KERNEL_QUIET: "1", MODEL_CREDENTIAL_KEY: randomBytes(32).toString("hex") };
const secretValues = [modelVars.DASHSCOPE_API_KEY!, baseEnv.MODEL_CREDENTIAL_KEY, ...DEV_MODE_ACCOUNTS.map(a => a.password)];
const scrub = (s: string) => secretValues.reduce((out, secret) => out.split(secret).join("[REDACTED]"), s).replace(/Bearer\s+[\w.\-]+/gi, "Bearer [REDACTED]");
const verifyChat = process.env.STUDIO_VERIFY_CHAT === "1";
const nativeDir = verifyChat ? await mkdtemp(join("/private/tmp/", "srn-")) : null;
const socketPath = nativeDir ? join(nativeDir, "skill-sandbox.sock") : "";
let relay: ReturnType<typeof createNetServer> | undefined;
const relaySockets = new Set<Socket>();
let nativeComposeFiles: string[] = [];
let nativeContainer = "";
const internalKey = randomBytes(32).toString("hex"), bindingKey = randomBytes(32).toString("hex");
secretValues.push(internalKey, bindingKey);
const children: ReturnType<typeof spawn>[] = [];
const logs: Promise<void>[] = [];
function start(args: string[], name: string, extra: NodeJS.ProcessEnv = {}, cwd = root) {
  const child = spawn(args[0]!, args.slice(1), { cwd, env: { ...baseEnv, ...extra }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let output = "";
  child.stdout!.on("data", chunk => { output += chunk.toString(); });
  child.stderr!.on("data", chunk => { output += chunk.toString(); });
  const finished = new Promise<void>(resolveLog => child.once("close", async () => { await writeFile(join(evidence, `${name}.log`), scrub(output), { mode: 0o600 }); resolveLog(); }));
  logs.push(finished); return child;
}
async function run(args: string[], name: string, extra: NodeJS.ProcessEnv = {}) {
  const child = start(args, name, extra);
  await new Promise<void>((ok, fail) => { child.once("error", fail); child.once("exit", code => code === 0 ? ok() : fail(new Error(`${name} failed code ${code}`))); });
}
async function ready(url: string, child: ReturnType<typeof spawn>) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error("owned service exited");
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.status < 500) return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("owned service readiness timeout");
}
let cleaning: Promise<void> | undefined;
function cleanup() { return cleaning ??= (async () => {
  let cleanupFailed = false;
  for (const socket of relaySockets) socket.destroy();
  relay?.close();
  for (const child of children.slice().reverse()) if (child.pid && child.exitCode === null) try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  for (const child of children) if (child.pid && child.exitCode === null) try { process.kill(-child.pid, "SIGKILL"); } catch {}
  await Promise.all(logs);
  if (nativeContainer) try { const output = execFileSync("docker", ["logs", nativeContainer], { env: baseEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); await writeFile(join(evidence, "native-container.log"), scrub(output), { mode: 0o600 }); } catch {}
  if (nativeComposeFiles.length) try { execFileSync("docker", ["compose", ...nativeComposeFiles, "-p", process.env.COMPOSE_PROJECT_NAME!, "down", "-v", "--remove-orphans"], { cwd: root, stdio: "ignore", timeout: 60000, env: baseEnv }); } catch { cleanupFailed = true; }
  if (nativeDir) await rm(nativeDir, { recursive: true, force: true });
  if (cleanupFailed) {
    await writeFile(join(evidence, "cleanup-failure.json"), JSON.stringify({ nativeComposeDownFailed: true }));
    throw new Error("Owned native compose cleanup failed; see cleanup-failure.json");
  }
  console.log(`OWNED_PROCESSES_CLEANED ${evidence}`);
})(); }
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });
process.once("SIGINT", () => { void cleanup().finally(() => process.exit(130)); });
const api = `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
let token = "";
async function request(path: string, body?: unknown) {
  const response = await fetch(api + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
  return response.json();
}
try {
  await run(["docker", "compose", "-f", "apps/api/docker-compose.dev.yml", "-p", process.env.COMPOSE_PROJECT_NAME!, "up", "-d", "--wait", "postgres", "redis", "minio"], "infra");
  await run(["pnpm", "exec", "tsx", "scripts/studio-skill-files-init-db.mts"], "migrate");
  await run(["pnpm", "--filter", "@repo/api", "exec", "tsx", "scripts/seed-dev-mode-accounts.ts"], "seed");
  const sandbox = start(["pnpm", "--filter", "@repo/skill-sandbox", "start"], "sandbox", { SKILL_SANDBOX_SOCKET: "", SKILL_SANDBOX_PORT: process.env.SKILL_SANDBOX_PORT });
  await ready(`http://127.0.0.1:${process.env.SKILL_SANDBOX_PORT}/`, sandbox);
  const deepOrigin = `http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT}`;
  if (verifyChat) {
    const nativeDist = join(evidence, "native-dist");
    await run(["pnpm", "--filter", "@repo/skill-sandbox", "exec", "tsc", "-p", "tsconfig.build.json", "--outDir", nativeDist], "native-compile");
    await cp(join(root, "apps/skill-sandbox/src/generated"), join(nativeDist, "generated"), { recursive: true });
    const overlay = join(evidence, "native-compose.json");
    await writeFile(overlay, JSON.stringify({ services: { "skill-sandbox-sessions": { volumes: [{ type: "bind", source: nativeDist, target: "/opt/sandbox/dist", read_only: true }] } } }));
    nativeComposeFiles = ["-f", "apps/skill-sandbox/docker-compose.sessions.yml", "-f", overlay];
    await run(["docker", "compose", ...nativeComposeFiles, "-p", process.env.COMPOSE_PROJECT_NAME!, "up", "-d", "--no-build", "skill-sandbox-sessions"], "native-infra");
    const container = execFileSync("docker", ["compose", ...nativeComposeFiles, "-p", process.env.COMPOSE_PROJECT_NAME!, "ps", "-q", "skill-sandbox-sessions"], { cwd: root, env: baseEnv, encoding: "utf8" }).trim();
    nativeContainer = container;
    if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error("No owned native sandbox container");
    const bridge = 'const n=require("node:net");const s=n.createConnection("/run/sessions/skill-sandbox.sock");s.on("error",()=>process.exit(1));process.stdin.pipe(s);s.pipe(process.stdout);s.on("close",()=>process.exit(0));';
    relay = createNetServer(socket => {
      relaySockets.add(socket);
      const child = spawn("docker", ["exec", "-i", container, "node", "-e", bridge], { env: baseEnv, detached: true, stdio: ["pipe", "pipe", "ignore"] }); children.push(child);
      socket.pipe(child.stdin!); child.stdout!.pipe(socket);
      child.on("error", () => socket.destroy()); child.once("exit", () => socket.destroy());
      socket.on("error", () => {}); child.stdin!.on("error", () => {});
      socket.once("close", () => { relaySockets.delete(socket); child.kill("SIGTERM"); });
    });
    await new Promise<void>((ok, fail) => { relay!.once("error", fail); relay!.listen(socketPath, ok); });
    async function socketRequest(method: string, path: string, body?: unknown, sessionToken?: string): Promise<{ status: number; body: Record<string, unknown> }> {
      return new Promise((ok, fail) => {
        const req = httpRequest({ socketPath, method, path, headers: { "content-type": "application/json", ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}) }, timeout: 15000 }, res => { let data = ""; res.on("data", chunk => { data += chunk; }); res.on("end", () => { try { ok({ status: res.statusCode!, body: JSON.parse(data) }); } catch { fail(new Error("native preflight invalid response")); } }); });
        req.on("error", fail); req.on("timeout", () => req.destroy(new Error("native preflight timeout"))); req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    }
    let nativeReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { const health = await socketRequest("GET", "/healthz"); if (health.status === 200) { nativeReady = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!nativeReady) throw new Error("native Linux service readiness failed");
    const created = await socketRequest("POST", "/sessions", {});
    if (created.status !== 201 || typeof created.body.sessionId !== "string" || typeof created.body.token !== "string") throw new Error("native preflight session unavailable");
    secretValues.push(created.body.token);
    try {
      const executed = await socketRequest("POST", `/sessions/${created.body.sessionId}/executions`, { executionId: randomUUID(), command: "printf native-preflight", timeoutMs: 5000 }, created.body.token);
      if (executed.status !== 200 || executed.body.exitCode !== 0 || executed.body.output !== "native-preflight") throw new Error(`native Linux execution preflight failed HTTP ${executed.status}`);
    } finally { await socketRequest("DELETE", `/sessions/${created.body.sessionId}`, undefined, created.body.token); }
    console.log("NATIVE_LINUX_EXECUTION_PREFLIGHT_PASS");
    const deepDir = join(evidence, "deep-agent"); await mkdir(deepDir);
    const config = { dependencies: [join(root, "apps/deep-agent-service")], graphs: { "Deep Agent": join(root, "apps/deep-agent-service/src/deep_agent_service/graph_selector.py:select_graph") }, http: { app: "deep_agent_service.retrieval_embeddings:app" } };
    await writeFile(join(deepDir, "langgraph.json"), JSON.stringify(config));
    const pythonBin = process.env.STUDIO_DEEP_AGENT_BIN ?? join(root, "apps/deep-agent-service/.venv/bin/langgraph");
    const deep = start([pythonBin, "dev", "--host", "127.0.0.1", "--port", process.env.WORKSPACEX_WEB_PORT!, "--allow-blocking", "--no-browser", "--no-reload", "--n-jobs-per-worker", "2"], "deep-agent", {
      PYTHONPATH: join(root, "apps/deep-agent-service/src"), KERNEL_MODEL_BASE_URL: modelVars.DASHSCOPE_BASE_URL, KERNEL_MODEL_API_KEY: modelVars.DASHSCOPE_API_KEY, KERNEL_DEEP_AGENT_MODEL_ID: modelVars.DASHSCOPE_MODEL,
      NATIVE_SESSION_SOCKET: socketPath, NATIVE_SESSION_SERVICE_BASE_URL: api, NATIVE_SESSION_SERVICE_KEY: internalKey,
      LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false", LANGGRAPH_API_URL: deepOrigin,
    }, deepDir);
    await ready(`${deepOrigin}/ok`, deep);
  }
  const service = start(["pnpm", "--filter", "@repo/api", "start"], "api", { PORT: process.env.WORKSPACEX_API_PORT, KERNEL_MODEL_PROVIDER: "dashscope", KERNEL_MODEL_BASE_URL: modelVars.DASHSCOPE_BASE_URL, KERNEL_MODEL_API_KEY: modelVars.DASHSCOPE_API_KEY, KERNEL_MODEL_ID: modelVars.DASHSCOPE_MODEL, KERNEL_SKILL_TRIALRUN_MODEL_ID: modelVars.DASHSCOPE_MODEL, KERNEL_MODEL_TIMEOUT_MS: "240000", KERNEL_SKILL_SANDBOX_BASE_URL: `http://127.0.0.1:${process.env.SKILL_SANDBOX_PORT}`, KERNEL_DEEP_AGENT_BASE_URL: verifyChat ? deepOrigin : "", ...(verifyChat ? { KERNEL_AGENT_RUN_AUTOSTART: "1", KERNEL_NATIVE_RUNTIME: "1", NATIVE_SESSION_SOCKET: socketPath, NATIVE_SESSION_BINDING_KEY: bindingKey, DEEP_AGENT_SERVICE_INTERNAL_KEY: internalKey, KERNEL_SUBTASK_CALLBACK_BASE_URL: api, KERNEL_DEFAULT_AGENT_MODEL_ID: modelVars.DASHSCOPE_MODEL, KERNEL_DEEP_AGENT_TIMEOUT_MS: "240000" } : {}) });
  await ready(`${api}/healthz`, service);
  const admin = DEV_MODE_ACCOUNTS.find(a => a.role === "admin")!;
  const login = await request("/auth/login", { email: admin.email, password: admin.password });
  token = login.sessionToken; if (!token) throw new Error("No authenticated session"); secretValues.push(token);
  const unique = randomUUID();
  const imported = wave2Runtime.operations.importSkillFromUrl.out.parse(await request("/admin/skills/url-imports", { sourceUrl: "https://github.com/anthropics/skills/tree/main/skills/skill-creator", name: `real-reference-${unique}`, idempotencyKey: unique }));
  const referencePath = `references/probe-${unique}.txt`;
  const canary = `file-only-${randomBytes(24).toString("hex")}`;
  const rootText = `---\nname: reference-reader\ndescription: Read an immutable package reference using Node fs.\nallowed-tools: run_script\n---\n# Reference reader\nIf native read_file is available, read ${referencePath} relative to this Skill directory under /skills/. Otherwise read ${referencePath} from process.env.SKILL_SANDBOX_INPUT_DIR using node:fs and node:path. Print its exact UTF-8 content to stdout. The content is not given in instructions; do not invent it. Only read the file, do not fetch network data.\n`;
  const put = (path: string, content: string) => ({ kind: "put" as const, path, contentBase64: Buffer.from(content).toString("base64"), mediaType: "text/plain" });
  const saved = skillFileEdit.operations.saveSkillFiles.out.parse(await request(`/admin/skills/${imported.skillId}/file-edits`, { expectedVersionId: imported.versionId, mutations: [put("SKILL.md", rootText), put(referencePath, canary)] }));
  const sampleInput = "Execute the Skill instructions: read the named immutable reference file with fs and print its exact contents. Do not print the path or a guessed value.";
  if (rootText.includes(canary) || sampleInput.includes(canary)) throw new Error("Canary leaked into model instruction");
  if (process.env.STUDIO_CHAT_ONLY !== "1") {
  const submitted = skills.operations.runTrialRun.out.parse(await request(`/skill-versions/${saved.versionId}/trial-run`, { versionId: saved.versionId, sampleInput }));
  if (!submitted.asyncTaskId) throw new Error("No async trial ID");
  console.log(`REAL_MODEL_TRIAL_STARTED ${submitted.asyncTaskId}`);
  let terminal: ReturnType<typeof skills.operations.getTrialRun.out.parse> | undefined;
  for (let i = 0; i < 180; i++) {
    const result = skills.operations.getTrialRun.out.parse(await request(`/skill-trial-runs/${submitted.asyncTaskId}`));
    if (result.status === "succeeded" || result.status === "failed") { terminal = result; break; }
    await new Promise(r => setTimeout(r, 2000));
  }
  await writeFile(join(evidence, "trial-result.json"), scrub(JSON.stringify(terminal ?? { status: "poll-timeout" }, null, 2)), { mode: 0o600 });
  if (terminal?.status !== "succeeded" || !terminal.trialRun) throw new Error(`Trial ${terminal?.status ?? "timeout"}: ${terminal?.failure?.code ?? "unknown"}`);
  if (terminal.trialRun.output.trim() !== canary) throw new Error("Real stdout does not match reference-only canary");
  const reread = skillFileEdit.operations.getSkillFileSnapshot.out.parse(await request(`/admin/skills/${imported.skillId}/file-snapshot?versionId=${saved.versionId}`));
  if (reread.files.find(f => f.path === referencePath)?.contentBase64 !== Buffer.from(canary).toString("base64")) throw new Error("Saved exact-version file mismatch");
  await writeFile(join(evidence, "receipt.json"), JSON.stringify({ gitHead, scriptDigest, scriptWasUncommitted: true, local: true, deepAgentExecuted: false, modelExecuted: true, skillId: imported.skillId, originalVersionId: imported.versionId, savedVersionId: saved.versionId, trialRunId: submitted.asyncTaskId, referencePath, referenceDigest: createHash("sha256").update(canary).digest("hex"), fileCount: reread.files.length, stdoutMatchedReferenceOnlyCanary: true, canaryAbsentFromInstructions: true, durationMs: terminal.trialRun.durationMs, tokens: terminal.trialRun.tokens, compose: process.env.COMPOSE_PROJECT_NAME, database: process.env.PGDATABASE }, null, 2));
  console.log(`REAL_MODEL_TRIAL_PASS ${evidence}`);
  }
  if (verifyChat) {
    const agent = wave2Runtime.operations.importAgentFromUrl.out.parse(await request("/admin/agents/url-imports", { sourceUrl: "https://raw.githubusercontent.com/anthropics/skills/main/template/SKILL.md", name: `real-reader-${unique}`, idempotencyKey: randomUUID() }));
    await request(`/agents/${agent.agentId}/self-publish`, { agentId: agent.agentId });
    const pinPath = `/admin/agents/${agent.agentId}/skill-pins`;
    const originalPins = agentRuntime.operations.getAgentSkillPins.out.parse(await request(pinPath));
    const pin = agentRuntime.operations.setAgentSkillPins.out.parse(await request(pinPath, { agentId: agent.agentId, expectedVersion: originalPins.publishedVersionId, skillVersionIds: [saved.versionId] }));
    const thread = chat.operations.mutateThread.out.parse(await request("/chat/threads/mutate", { op: "create", projectId: null, threadId: null, groupId: null, title: `Real reference ${unique}`, visibilityScope: "private", expectedVersion: null, reason: null }));
    const text = `Use the single pinned Skill's read_file capability to read the reference named ${referencePath} under its /skills/ directory. Return the exact file content. Do not guess. This is a read-only verification; no output artifact is needed.`;
    if (text.includes(canary)) throw new Error("Chat prompt leaked canary");
    const message = chat.operations.createMessage.out.parse(await request(`/chat/threads/${thread.threadId}/messages`, { threadId: thread.threadId, clientMessageId: randomUUID(), text, agentId: agent.agentId }));
    console.log(`REAL_MODEL_CHAT_STARTED ${message.agentRunId}`);
    let outcome: RunProjection | undefined;
    for (let i = 0; i < 180; i++) {
      const value = await request(`/agent-runs/${message.agentRunId}`) as RunProjection;
      if (["succeeded", "failed", "cancelled", "awaiting_tool_permission"].includes(value.status)) { outcome = value; break; }
      await new Promise(r => setTimeout(r, 2000));
    }
    const events = await request(`/agent-runs/${message.agentRunId}/execution-events`);
    const messages = chat.operations.listMessages.out.parse(await request(`/chat/threads/${thread.threadId}/messages`));
    await writeFile(join(evidence, "chat-result.json"), scrub(JSON.stringify({ outcome, events, messages }, null, 2)), { mode: 0o600 });
    if (outcome?.status !== "succeeded") throw new Error(`Chat ${outcome?.status ?? "timeout"}: ${outcome?.error ?? "unknown"}`);
    if (outcome.runId !== message.agentRunId || outcome.agentId !== agent.agentId || outcome.agentVersionId !== pin.versionId || JSON.stringify(outcome.skillVersionIds) !== JSON.stringify([saved.versionId]) || outcome.modelProvider !== "deep-agent") throw new Error("Chat run does not match exact pinned Agent/Skill/provider");
    const answer = messages.messages.find((item) => item.id === outcome.resultMessageId);
    if (!answer || !answer.text.includes(canary)) throw new Error("Chat answer did not include reference-only canary");
    const execution = ExecutionEvent.array().parse(events.events);
    const referenceRead = execution.find(event => event.kind === "tool_start" && event.toolName === "read_file" && typeof event.args === "object" && event.args !== null && "file_path" in event.args && typeof event.args.file_path === "string" && event.args.file_path.endsWith(`/${referencePath}`));
    if (!referenceRead || referenceRead.kind !== "tool_start") throw new Error("No actual reference read_file start");
    const readEnd = execution.find(event => event.kind === "tool_end" && event.toolCallId === referenceRead.toolCallId && event.toolName === "read_file" && event.ok && typeof event.result === "string" && event.result.includes(canary));
    if (!readEnd) throw new Error("No matched successful reference read_file result");
    await writeFile(join(evidence, "chat-receipt.json"), JSON.stringify({ gitHead, scriptDigest, scriptWasUncommitted: true, local: true, modelExecuted: true, deepAgentExecuted: true, runtime: "native", agentId: agent.agentId, agentVersionId: pin.versionId, savedSkillVersionId: saved.versionId, threadId: thread.threadId, agentRunId: message.agentRunId, canaryAbsentFromPrompt: true, answerMatchedReferenceOnlyCanary: true, actualReadFileEvent: true, referenceDigest: createHash("sha256").update(canary).digest("hex") }, null, 2));
    console.log(`REAL_MODEL_CHAT_PASS ${evidence}`);
  }

} finally { await cleanup(); }
