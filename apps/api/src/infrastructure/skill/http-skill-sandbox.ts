import { assertCurrentRunLease } from "../../application/agent-run/run-lease";
import type { SandboxInputFile } from "@repo/skill-sandbox/input-files";
/**
 * `SkillSandboxPort` 的唯一实现：经 HTTP 调 `apps/skill-sandbox` 的 `POST /run`
 * （design delta `skill-sandbox-execution` contract §3，F962 / #1583）。
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

/**
 * 这个部署到底**有没有**配沙箱地址 —— 唯一的判定处（#1652）。
 *
 * ## 为什么这不是「多此一举的一个 helper」
 *
 * 试跑与 chat 对「没配沙箱」的正确反应**不一样**，而两者共用同一个 `SKILL_SANDBOX_PORT`：
 *
 * | 调用方 | 没配沙箱时正确的行为 | 为什么 |
 * |---|---|---|
 * | 试跑（`SkillTrialRunExecutor`） | 照常调用，拿到 `SANDBOX_UNAVAILABLE` | 试跑**就是**为了执行，执行不了就是一次诚实的失败 |
 * | chat（`AgentRunExecutor`） | **整条路径不存在**（`sandbox` 不注入） | 用户问的是一句话，执行只是可选增强；没配就该与接沙箱之前逐字节相同 |
 *
 * 合成期不区分这两者会产生一条真实回归（#1652 T2 实测）：没接沙箱的部署里，
 * system prompt 照旧多出执行协议 → 模型据此吐出 `run_script` 块 → 上层去执行 →
 * 这里抛 `SANDBOX_UNAVAILABLE` → 用户本来好好的一条回复被追加上一段失败横幅。
 *
 * ⚠ 判据只写在这里一处，`kernel.module.ts` 的两个 provider 都读它。两处各写一遍
 *   `process.env.X !== undefined && process.env.X !== ""` 就是"同一事实声明在两处"——
 *   哪天多一个地址形态（比如第三种传输），只改一处的那半边会静默漂移回今天这条 bug。
 */
export function configuredSkillSandboxAddress(): HttpSkillSandboxConfig | null {
  const socketPath = process.env.KERNEL_SKILL_SANDBOX_SOCKET;
  const baseUrl = process.env.KERNEL_SKILL_SANDBOX_BASE_URL;
  const present = (v: string | undefined): boolean => v !== undefined && v !== "";
  if (!present(socketPath) && !present(baseUrl)) return null;
  return { socketPath, baseUrl };
}

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
    readonly inputFiles?: readonly SandboxInputFile[];
  }): Promise<SandboxRunResult> {
    await assertCurrentRunLease();
    const options = this.target();
    const payload = JSON.stringify({ script: input.script, timeoutMs: input.timeoutMs, ...(input.inputFiles ? { inputFiles: input.inputFiles } : {}) });

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
