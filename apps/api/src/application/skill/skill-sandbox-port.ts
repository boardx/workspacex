import type { SandboxInputFile } from "@repo/skill-sandbox/input-files";
/**
 * `SkillSandboxPort` —— 试跑执行模型生成脚本的应用层端口
 * （design delta `skill-sandbox-execution` contract §3，F962 / #1583）。
 *
 * ## 端口定义在 application 层，实现在 infrastructure —— 这是硬约束不是风格
 *
 * `interface/` 不许直接 import `infrastructure/`（`.harness/scripts/lint-arch-deps.mjs`
 * 机械门控）。controller 只认这里的类型，`kernel.module.ts` 负责把
 * `infrastructure/skill/http-skill-sandbox.ts` 的具体实现接上去。
 * 与 `ORG_AGENT_MODEL_READER`（#1499，就在 `trial-run-skill.ts` 里）同一条先例。
 *
 * ## 三个失败码为什么必须分开（contract §6.2）
 *
 * `SANDBOX_UNAVAILABLE`（沙箱服务不可达）、`SANDBOX_TIMEOUT`（脚本超硬超时）、
 * `SCRIPT_FAILED_AFTER_RETRIES`（回喂重试用尽仍失败）对应**三种完全不同的运维动作**：
 *
 * | 码 | 谁该被叫醒 | 该做什么 |
 * |---|---|---|
 * | `SANDBOX_UNAVAILABLE` | 运维 | 去看沙箱容器是不是挂了 / socket 是不是没挂上 |
 * | `SANDBOX_TIMEOUT` | 大概没人 | 单次现象；连续发生才看是不是超时配得太紧 |
 * | `SCRIPT_FAILED_AFTER_RETRIES` | 做 skill 的人 | 看模型为什么一直写不对，改 SKILL.md |
 *
 * 合成一个通用码会让线上**无法归因**（#1499 头注记过的同一条教训）。
 * `verification.md` V4-CP 就是抓这个的：合并成一个码，V4 必须变红。
 *
 * ⚠ 也**不得**与既有的 `MODEL_UNAVAILABLE` / `DEPENDENCY_UNAVAILABLE` 合并 ——
 *   "模型没配好"、"沙箱挂了"、"模型写的脚本一直修不对"是三件事。
 */

/** 沙箱执行产出的一个文件。`contentBase64` 是 `POST /run` 的 JSON 契约形态。 */
export interface SandboxArtifact {
  readonly name: string;
  readonly contentBase64: string;
  readonly sizeBytes: number;
}

/**
 * 一次执行的结果。
 *
 * ⚠ **脚本非零退出不是这一层的错误**——它是一次成功的执行，只是脚本失败了，
 *   是 contract §7 回喂重试循环的正常输入。只有"沙箱自己坏了"才 throw。
 */
export interface SandboxRunResult {
  /** 被信号杀死时为 null（`timedOut` 同时为 true）。 */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly files: readonly SandboxArtifact[];
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface SkillSandboxPort {
  /**
   * 在沙箱里执行一段脚本。
   *
   * @throws {SandboxUnavailableError} 沙箱服务不可达 / 回了非 200 / 回了读不懂的东西。
   *   ⚠ 不要把它降级成"回一个 exitCode 非零的结果"——那会让调用方把运维故障
   *   当成"模型写的脚本有问题"，然后白白重试三次，最后报一个错误的失败码。
   */
  run(input: { readonly script: string; readonly timeoutMs: number; readonly inputFiles?: readonly SandboxInputFile[] }): Promise<SandboxRunResult>;
}

export class SandboxUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`sandbox unavailable: ${detail}`);
    this.name = "SandboxUnavailableError";
  }
}

export const SKILL_SANDBOX_PORT = Symbol("SkillSandboxPort");
