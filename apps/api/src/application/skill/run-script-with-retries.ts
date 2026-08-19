/**
 * contract §7 的回喂重试循环：模型写脚本 → 沙箱执行 → 非零退出把
 * `exitCode` + 截断后的 `stdout/stderr` 回喂 → 重新生成 → 上限 **N=3** 次。
 * （design delta `skill-sandbox-execution`，F210 / #1583）
 *
 * ## ⚠ 为什么不是「给模型挂一个 run_script 工具」——这是读了代码之后的改法
 *
 * contract §7 的字面表述是「模型带 `run_script` 工具」。但 `ModelCallPort` **没有**
 * 工具调用面：`ToolDefinition` / `ToolCallRequest` / `ToolExchangeTurn`（#725）在
 * **#741 被显式退役**，连同它们服务的那个 TS 进程内工具循环一起删掉了
 * （见 `application/agent-run/ports.ts` 的对应头注）。
 *
 * ⇒ 要照字面实现，就得把一条刚被刻意关掉的门重新打开，并让**全部** provider
 *   实现都跟着改。本文件改为在**已有的 `complete()` 面**上做同一件事：
 *   系统提示要求模型把脚本放进一个带标记的代码块 → 这里解析出来 → 执行 →
 *   失败时把真实 `exitCode`/`stderr` 作为下一轮 `history` 里的一条 user 消息回喂。
 *
 * **行为等价**（模型写脚本、执行、失败回喂、上限 3 次），**机制不同**（提示协议
 * 而非原生 tool call）。这一点已在 #1583 上写明供 review 裁决；若 review 要求恢复
 * 原生工具面，那是一次独立的、跨全部 provider 的改动，不该塞进本切片。
 *
 * ⚠ 佐证这条协议可行的不是推测：#1570 实测里真实模型的回复中**已经**自发出现了
 *   字面 `<tool_call>` 块——它本来就在往外吐结构化块，只是那时没人接。
 *
 * ## 失败必须原样带回最后一次真实 stderr
 *
 * 重试用尽时抛 `ScriptFailedAfterRetriesError`，**携带最后一次的 stderr 原文**。
 * ⚠ 不翻译成「生成失败，请重试」——那会让真实原因消失（#660 已记过的同一条纪律）。
 * `verification.md` V4 会断言 stderr 原文确实出现在响应里。
 */
import {
  SandboxUnavailableError,
  type SandboxArtifact,
  type SkillSandboxPort,
} from "./skill-sandbox-port";

/** contract §7：上限 3 次。实测第 2 次即收敛（#1575 ②），留一次余量。 */
export const MAX_SCRIPT_ATTEMPTS = 3;

/** 回喂给模型的输出截断长度——够定位错误，又不至于把上下文吃光。 */
const FEEDBACK_EXCERPT_CHARS = 4_000;

export class ScriptFailedAfterRetriesError extends Error {
  constructor(
    readonly attempts: number,
    /** ⚠ 最后一次执行的**真实** stderr，原样保存，不加工。 */
    readonly lastStderr: string,
    readonly lastExitCode: number | null,
  ) {
    super("SCRIPT_FAILED_AFTER_RETRIES");
    this.name = "ScriptFailedAfterRetriesError";
  }
}

export class SandboxTimeoutError extends Error {
  constructor(readonly attempts: number) {
    super("SANDBOX_TIMEOUT");
    this.name = "SandboxTimeoutError";
  }
}

export { SandboxUnavailableError };

/** 模型必须把脚本放进这个标记块里。 */
const SCRIPT_FENCE_OPEN = "```run_script";

export const RUN_SCRIPT_PROTOCOL_PROMPT = [
  "You can execute Node.js code in a sandbox to produce real files.",
  "",
  "To do so, reply with exactly one fenced block:",
  "",
  SCRIPT_FENCE_OPEN,
  "// CommonJS. `require` is available. Do NOT run npm install — dependencies are preinstalled.",
  "// Write every file you want to return into process.env.SKILL_SANDBOX_OUT_DIR.",
  "```",
  "",
  "The sandbox has NO network access. Only the preinstalled modules are available.",
  "If the script exits non-zero you will receive its exit code and stderr, and may correct it.",
].join("\n");

export interface ScriptAttemptRecord {
  readonly attempt: number;
  readonly exitCode: number | null;
  readonly stderr: string;
}

export interface RunScriptWithRetriesResult {
  readonly script: string;
  readonly stdout: string;
  readonly files: readonly SandboxArtifact[];
  /** 实际发生的执行次数。⚠ `verification.md` V3 直接断言这个数。 */
  readonly attempts: number;
  readonly history: readonly ScriptAttemptRecord[];
}

export interface RunScriptWithRetriesDeps {
  readonly sandbox: SkillSandboxPort;
  /**
   * 生成第 `attempt` 次脚本。`feedback` 为 `null` 表示首次；否则是上一次失败的
   * 回喂文本，调用方负责把它作为一条 user 消息送进模型。
   */
  readonly generateScript: (feedback: string | null) => Promise<string>;
  readonly timeoutMs: number;
  readonly maxAttempts?: number;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

export async function runScriptWithRetries(
  deps: RunScriptWithRetriesDeps,
): Promise<RunScriptWithRetriesResult> {
  const maxAttempts = deps.maxAttempts ?? MAX_SCRIPT_ATTEMPTS;
  const history: ScriptAttemptRecord[] = [];
  let feedback: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await deps.generateScript(feedback);
    const script = extractScript(raw);

    // ⚠ 沙箱不可达时**立刻**抛出，不消耗重试次数：重试只对"脚本写错了"有意义，
    //   对"服务挂了"重试三次只会让一次运维故障被报成 SCRIPT_FAILED_AFTER_RETRIES。
    const result = await deps.sandbox.run({ script, timeoutMs: deps.timeoutMs });

    if (result.timedOut) {
      // 同理：超时是资源/脚本行为问题，且容器已被回收，不在这里重试。
      throw new SandboxTimeoutError(attempt);
    }

    if (result.exitCode === 0) {
      return { script, stdout: result.stdout, files: result.files, attempts: attempt, history };
    }

    history.push({ attempt, exitCode: result.exitCode, stderr: result.stderr });
    deps.log?.("skill trial run script attempt failed", {
      attempt,
      exitCode: result.exitCode,
      stderrExcerpt: excerpt(result.stderr),
    });

    feedback = [
      `The script failed with exit code ${String(result.exitCode)}.`,
      "",
      "stderr:",
      excerpt(result.stderr),
      "",
      "stdout:",
      excerpt(result.stdout),
      "",
      "Fix the script and reply with a single corrected run_script block.",
    ].join("\n");
  }

  const last = history[history.length - 1]!;
  throw new ScriptFailedAfterRetriesError(maxAttempts, last.stderr, last.exitCode);
}

/**
 * 从模型回复里取出脚本。
 *
 * 宽容一点是有理由的：模型经常在代码块前后写解释文字，偶尔把 fence 标成 ```js。
 * 但**不宽容到"整段回复当脚本跑"**——那会把模型的散文喂给 node，产生一堆
 * 与真实问题无关的语法错误，把回喂循环的信噪比毁掉。
 */
export function extractScript(reply: string): string {
  const fenced = /```(?:run_script|javascript|js|node)?\s*\n([\s\S]*?)```/.exec(reply);
  if (fenced?.[1] !== undefined && fenced[1].trim() !== "") return fenced[1];
  throw new ScriptFailedAfterRetriesError(
    1,
    `model reply contained no fenced script block; reply was:\n${excerpt(reply)}`,
    null,
  );
}

function excerpt(text: string): string {
  return text.length <= FEEDBACK_EXCERPT_CHARS
    ? text
    : `${text.slice(0, FEEDBACK_EXCERPT_CHARS)}\n...[truncated]`;
}
