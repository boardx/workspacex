/**
 * `apps/skill-sandbox` 的 HTTP 面（contract §3 里 `HttpSkillSandbox` 打过来的那一端）。
 *
 * 形态复用 `apps/deep-agent-service`（#739/#740）那一条:独立服务 + 自己的容器 +
 * HTTP 契约 + 测试用 loopback 替身。**不复用它的语言栈**——它是 Python/LangGraph,
 * 本服务是 Node,因为 contract §2 限定首个切片只做 `pptxgenjs`(纯 Node)那条路径。
 *
 * ## 这个服务自己没有鉴权,这是刻意的
 *
 * 与 deep-agent-service 同一条纪律:它只监听容器网络内部/回环,不对外暴露,
 * 由 `apps/api` 作为唯一调用方。⚠ 部署时必须 `127.0.0.1:<port>:<port>` 绑回环。
 *
 * ## `POST /run` 契约
 *
 * in : `{ script: string, timeoutMs: number }`
 * out: `{ exitCode: number|null, stdout: string, stderr: string,
 *         files: [{ name, contentBase64, sizeBytes }], timedOut: boolean, durationMs: number }`
 *
 * ⚠ **脚本非零退出不是 HTTP 错误**——它是一次成功的执行,只是脚本失败了。
 *   HTTP 200 + `exitCode !== 0` 是 contract §7 回喂重试循环的正常输入。
 *   只有"沙箱自己坏了"才回非 200。把脚本失败映射成 5xx 会让调用侧分不清
 *   `SANDBOX_UNAVAILABLE`(运维要去看服务)与 `SCRIPT_FAILED_AFTER_RETRIES`
 *   (模型写的脚本一直修不对),而 contract §6.2 明确要求这两件事不能合并。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { executeScript } from "./execute-script.js";
import { SessionManager } from "./session/manager.js";
import { BubblewrapProvider } from "./session/provider.js";
import { handleSessionRequest } from "./session/http.js";

/** 单次执行的 wall-clock 硬上限。调用方给的 `timeoutMs` 只能更小,不能更大。 */
export const MAX_TIMEOUT_MS = 300_000;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 请求体上限——脚本是模型写的,不该有兆级的。 */
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface SandboxServerOptions {
  readonly preinstalledModulesDir?: string;
  /** 预装 CJK 字体文件路径（镜像里的 `SKILL_SANDBOX_CJK_FONT`）——PDF 画中文用。 */
  readonly cjkFontPath?: string;
  readonly nodeBinary?: string;
  readonly sessionManager?: SessionManager;
  /** Dedicated instance using the session setup seccomp profile; never serves legacy /run. */
  readonly sessionsOnly?: boolean;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

export function createSandboxServer(options: SandboxServerOptions = {}): Server {
  const sessions = options.sessionManager ?? new SessionManager(new BubblewrapProvider());
  const timer = setInterval(() => { void sessions.reapExpired().catch(() => undefined); }, 10000);
  timer.unref();
  const server = createServer((req, res) => {
    void (async () => {
      if (!await handleSessionRequest(req, res, sessions)) await handle(req, res, options);
    })().catch((e: unknown) => {
      // 兜底:任何未预期的异常都回 500,让调用侧映射成 SANDBOX_UNAVAILABLE,
      // 而不是悄悄回一个"看起来成功"的空结果。
      send(res, 500, { error: e instanceof Error ? e.message : "unexpected sandbox failure" });
    });
  });
  server.on("close", () => clearInterval(timer));
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: SandboxServerOptions,
): Promise<void> {
  const url = req.url ?? "/";

  if (req.method === "GET" && url.startsWith("/healthz")) {
    send(res, 200, { ok: true });
    return;
  }

  if (options.sessionsOnly || req.method !== "POST" || !url.startsWith("/run")) {
    send(res, 404, { error: "not found" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: "invalid json body" });
    return;
  }

  const body = parsed as { script?: unknown; timeoutMs?: unknown };
  if (typeof body.script !== "string" || body.script === "") {
    send(res, 400, { error: "script must be a non-empty string" });
    return;
  }

  const requested = typeof body.timeoutMs === "number" ? body.timeoutMs : DEFAULT_TIMEOUT_MS;
  // 调用方只能收紧,不能放宽——否则一个 timeoutMs: 1e9 就把 wall-clock 硬超时废掉了。
  const timeoutMs = Math.max(1, Math.min(Math.floor(requested), MAX_TIMEOUT_MS));

  const result = await executeScript({
    script: body.script,
    timeoutMs,
    nodeBinary: options.nodeBinary,
    preinstalledModulesDir: options.preinstalledModulesDir,
    cjkFontPath: options.cjkFontPath,
  });

  send(res, 200, result);
}
