/**
 * real-model-evidence.ts —— 真实模型 e2e 通道（issue #2802）的证据采集器。
 *
 * ## 为什么要有它
 *
 * #2795 的真正根因（`Agent ... not found` + `WebSocket is closed before the
 * connection is established` + `Error: terminated`）是**人类手动打开 Chrome
 * DevTools 截图**才第一次拿到的。在那之前每一轮排查都只能做静态代码分析。
 * 这个文件把那次人工动作变成自动动作：浏览器控制台、页面异常、失败/超时的网络
 * 请求、SSE/WS 的连接生命周期与时刻，全部自动落盘，打成一个远程分析者**不需要
 * 任何其它通路**就能读懂的包。
 *
 * ## 脱敏是硬约束，不是"尽量"
 *
 * 写盘的每一个字符串都过 `scrubSecrets`。脱敏表由两部分构成：
 *   ① 进程环境里**看起来像凭据**的变量的真实值（逐字替换）——这是最可靠的一层，
 *      因为它不依赖"日志长什么样"的猜测；
 *   ② 一组形态正则（Bearer/sk-/Authorization/set-cookie/password 字段）——兜住
 *      那些不来自本进程环境的值（比如后端日志里别的服务的 token）。
 * 两层都不敢声称"绝对不漏"，所以证据包里刻意不收原始请求头/响应体全文，只收
 * 结构化的元信息（URL、状态码、时刻、失败原因）与我们自己写的断言结论。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CDPSession, ConsoleMessage, Page, Request, Response, WebSocket } from "@playwright/test";

/** 一条断言的结论——证据包与 job log 共用同一份数据，不各写一遍。 */
export interface AssertionRecord {
  readonly name: string;
  readonly ok: boolean;
  /** 判定依据（真实观测到的东西），不是复述断言本身。 */
  readonly detail: string;
}

interface ConsoleRecord {
  readonly at: string;
  readonly type: string;
  readonly text: string;
  readonly location: string;
}

interface NetworkFailureRecord {
  readonly at: string;
  readonly kind: "requestfailed" | "http-error";
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly failure: string | null;
}

interface WsRecord {
  readonly at: string;
  readonly event: "created" | "closed" | "socketerror" | "framesent" | "framereceived";
  readonly url: string;
  readonly detail?: string;
}

interface StreamRecord {
  readonly at: string;
  readonly event: string;
  readonly requestId: string;
  readonly url: string;
  readonly detail?: string;
}

/** 环境变量名长这样的，它的值一律进脱敏表。 */
const SECRET_ENV_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|COOKIE|DSN)/i;

/** 形态脱敏：不依赖本进程环境，兜住来自后端日志/第三方的凭据形态。 */
const SECRET_SHAPES: readonly (readonly [RegExp, string])[] = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer <REDACTED>"],
  [/\b(sk|xoxb|ghp|gho|ghs|glpat)-[A-Za-z0-9._-]{8,}/g, "<REDACTED-APIKEY>"],
  [/("(?:password|passwd|apiKey|api_key|token|secret)"\s*:\s*)"[^"]*"/gi, '$1"<REDACTED>"'],
  [/((?:authorization|set-cookie|cookie|x-api-key)\s*[:=]\s*)\S+/gi, "$1<REDACTED>"],
  [/\b([A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL))=\S+/gi, "$1=<REDACTED>"],
];

function literalSecrets(): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    // 8 个字符以下的值不进表：太短的字符串逐字替换会把无关文本打成马赛克，
    // 反而让证据不可读（"1"、"true" 这类开关值正是这个形态）。
    if (typeof value === "string" && value.length >= 8 && SECRET_ENV_NAME.test(name)) {
      out.push(value);
    }
  }
  // 长的先替换：短值可能是长值的前缀，先替短的会把长的切碎成"<REDACTED>尾巴"。
  return out.sort((a, b) => b.length - a.length);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 写盘/打日志的**唯一出口**都要过它。测试见 `tests/e2e-support/real-model-evidence.test.ts`。 */
export function scrubSecrets(input: string, extraSecrets: readonly string[] = []): string {
  let text = input;
  for (const secret of [...literalSecrets(), ...extraSecrets].sort((a, b) => b.length - a.length)) {
    if (secret.length < 8) continue;
    text = text.replace(new RegExp(escapeForRegExp(secret), "g"), "<REDACTED>");
  }
  for (const [pattern, replacement] of SECRET_SHAPES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/** AG-UI / CopilotKit 的流式端点——SSE 生命周期只对这些 URL 记录，避免把整站流量灌进包里。 */
function isStreamUrl(url: string): boolean {
  return /\/api\/copilotkit|\/copilotkit\/agui|\/runs?\/|\/stream/.test(url);
}

export class RealModelEvidence {
  readonly dir: string;
  private readonly consoleRecords: ConsoleRecord[] = [];
  private readonly pageErrors: ConsoleRecord[] = [];
  private readonly networkFailures: NetworkFailureRecord[] = [];
  private readonly wsRecords: WsRecord[] = [];
  private readonly streamRecords: StreamRecord[] = [];
  private readonly assertions: AssertionRecord[] = [];
  private readonly context: Record<string, unknown> = {};
  private readonly extraSecrets: string[] = [];
  private readonly startedAt = Date.now();
  /** `finish()` 幂等的守卫——正常路径与 `afterEach` 兜底路径都会调它，只该落一次盘。 */
  private finished = false;

  constructor(dir: string, extraSecrets: readonly string[] = []) {
    this.dir = dir;
    this.extraSecrets = [...extraSecrets];
    mkdirSync(dir, { recursive: true });
  }

  private stamp(): string {
    return `${new Date().toISOString()} (+${((Date.now() - this.startedAt) / 1000).toFixed(3)}s)`;
  }

  private clean(text: string): string {
    return scrubSecrets(text, this.extraSecrets);
  }

  /** 挂上所有监听。CDP 那一段是可选增强：拿不到就退化成 Playwright 事件，不让整条用例红。 */
  async attach(page: Page): Promise<void> {
    page.on("console", (msg: ConsoleMessage) => {
      const record: ConsoleRecord = {
        at: this.stamp(),
        type: msg.type(),
        text: this.clean(msg.text()),
        location: this.clean(`${msg.location().url}:${msg.location().lineNumber}`),
      };
      this.consoleRecords.push(record);
    });

    page.on("pageerror", (error: Error) => {
      this.pageErrors.push({
        at: this.stamp(),
        type: "pageerror",
        text: this.clean(`${error.name}: ${error.message}`),
        location: this.clean(error.stack ?? ""),
      });
    });

    page.on("requestfailed", (request: Request) => {
      this.networkFailures.push({
        at: this.stamp(),
        kind: "requestfailed",
        method: request.method(),
        url: this.clean(request.url()),
        status: null,
        failure: this.clean(request.failure()?.errorText ?? "unknown"),
      });
    });

    page.on("response", (response: Response) => {
      if (response.status() >= 400) {
        this.networkFailures.push({
          at: this.stamp(),
          kind: "http-error",
          method: response.request().method(),
          url: this.clean(response.url()),
          status: response.status(),
          failure: null,
        });
      }
    });

    page.on("websocket", (ws: WebSocket) => {
      const url = this.clean(ws.url());
      this.wsRecords.push({ at: this.stamp(), event: "created", url });
      // 帧内容不落盘（可能带 token/用户内容），只记"这一刻有一帧"与字节数——
      // #2795 要判的是"连接有没有在跑到一半时断掉"，那是时刻问题，不是内容问题。
      ws.on("framesent", (frame) => {
        this.wsRecords.push({
          at: this.stamp(),
          event: "framesent",
          url,
          detail: `${typeof frame.payload === "string" ? frame.payload.length : frame.payload.byteLength} bytes`,
        });
      });
      ws.on("framereceived", (frame) => {
        this.wsRecords.push({
          at: this.stamp(),
          event: "framereceived",
          url,
          detail: `${typeof frame.payload === "string" ? frame.payload.length : frame.payload.byteLength} bytes`,
        });
      });
      ws.on("socketerror", (error) => {
        this.wsRecords.push({ at: this.stamp(), event: "socketerror", url, detail: this.clean(error) });
      });
      ws.on("close", () => {
        this.wsRecords.push({ at: this.stamp(), event: "closed", url });
      });
    });

    await this.attachStreamLifecycle(page);
  }

  /**
   * SSE 的**逐块到达时刻**。
   *
   * 刻意不用 `page.route()` 去拦 AG-UI 那条 POST：拦截会把流整个缓冲下来再交给页面，
   * 而这条通道要测的恰恰是"长时间空闲时连接会不会被网关掐断"——缓冲会把被测现象
   * 本身改掉（`copilotkit-v2-active-file-panel.spec.ts` 用 route 是因为它要**篡改**
   * 帧，目的不同）。CDP 的 Network 域是旁路观测：只报告，不改变传输。
   */
  private async attachStreamLifecycle(page: Page): Promise<void> {
    let client: CDPSession;
    try {
      client = await page.context().newCDPSession(page);
      await client.send("Network.enable");
    } catch (error) {
      this.streamRecords.push({
        at: this.stamp(),
        event: "cdp-unavailable",
        requestId: "-",
        url: "-",
        detail: this.clean(String(error)),
      });
      return;
    }
    const watched = new Map<string, string>();
    client.on("Network.requestWillBeSent", (event) => {
      const url = String((event as { request: { url: string } }).request.url);
      if (!isStreamUrl(url)) return;
      const id = String((event as { requestId: string }).requestId);
      watched.set(id, url);
      this.streamRecords.push({ at: this.stamp(), event: "request", requestId: id, url: this.clean(url) });
    });
    client.on("Network.responseReceived", (event) => {
      const id = String((event as { requestId: string }).requestId);
      const url = watched.get(id);
      if (url === undefined) return;
      const status = (event as { response: { status: number } }).response.status;
      this.streamRecords.push({
        at: this.stamp(),
        event: "response",
        requestId: id,
        url: this.clean(url),
        detail: `status=${status}`,
      });
    });
    client.on("Network.dataReceived", (event) => {
      const id = String((event as { requestId: string }).requestId);
      const url = watched.get(id);
      if (url === undefined) return;
      // 每一块的到达时刻就是"流还活着"的证据；块内容不落盘。
      this.streamRecords.push({
        at: this.stamp(),
        event: "chunk",
        requestId: id,
        url: this.clean(url),
        detail: `${(event as { dataLength: number }).dataLength} bytes`,
      });
    });
    client.on("Network.loadingFinished", (event) => {
      const id = String((event as { requestId: string }).requestId);
      const url = watched.get(id);
      if (url === undefined) return;
      this.streamRecords.push({ at: this.stamp(), event: "finished", requestId: id, url: this.clean(url) });
    });
    client.on("Network.loadingFailed", (event) => {
      const id = String((event as { requestId: string }).requestId);
      const url = watched.get(id);
      if (url === undefined) return;
      const failed = event as { errorText?: string; canceled?: boolean };
      this.streamRecords.push({
        at: this.stamp(),
        event: "failed",
        requestId: id,
        url: this.clean(url),
        detail: this.clean(`${failed.errorText ?? "unknown"} canceled=${String(failed.canceled ?? false)}`),
      });
    });
  }

  /** 运行上下文（base URL / 目标 / 解析出来的 thread id 之类）。值同样过脱敏。 */
  setContext(key: string, value: unknown): void {
    this.context[key] = typeof value === "string" ? this.clean(value) : value;
  }

  record(name: string, ok: boolean, detail: string): AssertionRecord {
    const entry: AssertionRecord = { name, ok, detail: this.clean(detail) };
    this.assertions.push(entry);
    return entry;
  }

  /** 已记录的控制台错误（含 pageerror），供断言判定 SSE/WS 传输失败用。 */
  consoleErrors(): readonly ConsoleRecord[] {
    return [...this.consoleRecords.filter((r) => r.type === "error"), ...this.pageErrors];
  }

  streamFailures(): readonly StreamRecord[] {
    return this.streamRecords.filter((r) => r.event === "failed");
  }

  writeText(file: string, body: string): string {
    const target = path.join(this.dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, this.clean(body), "utf8");
    return target;
  }

  writeJson(file: string, data: unknown): string {
    return this.writeText(file, JSON.stringify(data, null, 2));
  }

  writeBinary(file: string, bytes: Uint8Array): string {
    const target = path.join(this.dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return target;
  }

  /**
   * 落盘 + **把结论打进 job log**。
   *
   * 后半句是刻意的：远程协调员读 `get_job_logs` 就该拿到判决，不必先下载 artifact。
   * artifact 是给"要看细节"的人，job log 是给"要知道过没过"的人。
   */
  finish(): { readonly passed: number; readonly failed: number } {
    if (this.finished) {
      const already = this.assertions.filter((a) => !a.ok).length;
      return { passed: this.assertions.length - already, failed: already };
    }
    this.finished = true;
    this.writeJson("00-context.json", { ...this.context, generatedAt: new Date().toISOString() });
    this.writeJson("10-assertions.json", this.assertions);
    this.writeJson("20-console.json", this.consoleRecords);
    this.writeJson("21-page-errors.json", this.pageErrors);
    this.writeJson("30-network-failures.json", this.networkFailures);
    this.writeJson("31-stream-lifecycle.json", this.streamRecords);
    this.writeJson("32-websocket-lifecycle.json", this.wsRecords);

    const failed = this.assertions.filter((a) => !a.ok);
    const lines: string[] = [];
    lines.push("");
    lines.push("════════ 真实模型 PDF 用例 —— 逐条断言结论 ════════");
    for (const a of this.assertions) {
      lines.push(`${a.ok ? "✅" : "❌"} ${a.name}`);
      lines.push(`     ${a.detail}`);
    }
    lines.push(`── 控制台 error ${this.consoleRecords.filter((r) => r.type === "error").length} 条 · `
      + `页面异常 ${this.pageErrors.length} 条 · 失败请求 ${this.networkFailures.length} 条 · `
      + `流事件 ${this.streamRecords.length} 条 · WS 事件 ${this.wsRecords.length} 条`);
    for (const err of this.consoleErrors().slice(0, 20)) {
      lines.push(`   ⚠ [${err.type}] ${err.text}`);
    }
    lines.push(`════════ ${this.assertions.length - failed.length}/${this.assertions.length} 通过 ════════`);
    lines.push("");
    const summary = lines.join("\n");
    // 已经逐字段脱敏过；这里再过一遍是因为拼接引入了新文本（断言名/计数）。
    process.stdout.write(scrubSecrets(summary, this.extraSecrets));
    this.writeText("01-verdict.txt", summary);
    return { passed: this.assertions.length - failed.length, failed: failed.length };
  }
}
