/**
 * `SkillSandboxPort` 的唯一实现：经 HTTP 调 `apps/skill-sandbox` 的 `POST /run`
 * （design delta `skill-sandbox-execution` contract §3，F210 / #1583）。
 *
 * ## 走 unix socket，不是端口
 *
 * 沙箱容器是 `network: none` 的（contract §4 L1），没有网络接口，TCP 上根本连不上。
 * 通信经共享 volume 上的 unix domain socket——完整推理见
 * `apps/skill-sandbox/src/main.ts` 头注（其中说明了为什么不选"给沙箱留网络"和
 * "挂 docker socket 起临时容器"这两条）。
 * `baseUrl` 形态保留 TCP 分支，仅供本地开发与 loopback 替身使用。
 *
 * ## 什么算 `SANDBOX_UNAVAILABLE`，什么不算
 *
 * ⚠ **脚本非零退出不算**。那是一次成功的执行（HTTP 200 + `exitCode !== 0`），
 *   是 contract §7 回喂重试的正常输入。只有连不上、非 200、响应读不懂才算。
 *   把脚本失败映射成不可达会让运维分不清"沙箱挂了"和"模型写的脚本有问题"，
 *   而 contract §6.2 明确要求这两件事不能合并。
 */
import { request, type RequestOptions } from "node:http";
import {
  SandboxUnavailableError,
  type SandboxRunResult,
  type SkillSandboxPort,
} from "../../application/skill/skill-sandbox-port";

export interface HttpSkillSandboxConfig {
  /** unix socket 路径（生产形态）。与 `baseUrl` 二选一。 */
  readonly socketPath?: string;
  /** `http://127.0.0.1:<port>`（本地开发 / loopback 替身）。 */
  readonly baseUrl?: string;
  /** 客户端侧等待上限；应显著大于沙箱自己的 wall-clock 硬超时。 */
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 360_000;

export class HttpSkillSandbox implements SkillSandboxPort {
  constructor(private readonly config: HttpSkillSandboxConfig) {}

  /** 未配置任何地址 ⇒ 这个部署没接沙箱。调用时诚实报不可达，不在 boot 时崩。 */
  private target(): RequestOptions {
    const timeout = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (this.config.socketPath !== undefined && this.config.socketPath !== "") {
      return { socketPath: this.config.socketPath, path: "/run", method: "POST", timeout };
    }
    if (this.config.baseUrl !== undefined && this.config.baseUrl !== "") {
      const url = new URL("/run", this.config.baseUrl);
      return {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        timeout,
      };
    }
    throw new SandboxUnavailableError("no sandbox socketPath or baseUrl configured");
  }

  async run(input: {
    readonly script: string;
    readonly timeoutMs: number;
  }): Promise<SandboxRunResult> {
    const options = this.target();
    const payload = JSON.stringify({ script: input.script, timeoutMs: input.timeoutMs });

    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          ...options,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode !== 200) {
              reject(
                new SandboxUnavailableError(
                  `sandbox returned HTTP ${String(res.statusCode)}: ${text.slice(0, 500)}`,
                ),
              );
              return;
            }
            resolve(text);
          });
          res.on("error", (e: Error) => reject(new SandboxUnavailableError(e.message)));
        },
      );
      req.once("error", (e: Error) => reject(new SandboxUnavailableError(e.message)));
      req.once("timeout", () => {
        req.destroy();
        reject(new SandboxUnavailableError("sandbox request timed out"));
      });
      req.end(payload);
    });

    return parseResult(body);
  }
}

/**
 * 严格解析。⚠ 读不懂就报不可达，**不要**填一个"看起来成功"的默认值——
 * 一个 `exitCode: 0, files: []` 的兜底会让 V1 那种"总是回空文件"的假绿悄悄发生。
 */
function parseResult(body: string): SandboxRunResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SandboxUnavailableError(`sandbox returned non-JSON body: ${body.slice(0, 500)}`);
  }
  const r = parsed as Partial<SandboxRunResult>;
  if (
    (typeof r.exitCode !== "number" && r.exitCode !== null) ||
    typeof r.stdout !== "string" ||
    typeof r.stderr !== "string" ||
    !Array.isArray(r.files) ||
    typeof r.timedOut !== "boolean"
  ) {
    throw new SandboxUnavailableError(`sandbox returned an unreadable result: ${body.slice(0, 500)}`);
  }
  return {
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    files: r.files,
    timedOut: r.timedOut,
    durationMs: typeof r.durationMs === "number" ? r.durationMs : 0,
  };
}
