import type { SandboxInputFile } from "@repo/skill-sandbox/input-files";
/**
 * contract §7 的回喂重试循环：模型写脚本 → 沙箱执行 → 非零退出把
 * `exitCode` + 截断后的 `stdout/stderr` 回喂 → 重新生成 → 上限 **N=3** 次。
 * （design delta `skill-sandbox-execution`，F962 / #1583）
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

/**
 * 脚本块的**唯一**解析规则。`extractScript`（抛版）与 `tryExtractScript`（不抛版，#1624）
 * 共用它——两处各写一份正则就是"同一事实声明在两处"，改了一处另一处会静默漂移。
 * ⚠ 无 `g` 标志：带 `g` 的正则字面量在模块级复用会因 `lastIndex` 残留而随调用次数变结果。
 */
const SCRIPT_FENCE_RE = /```(?:run_script|javascript|js|node)?\s*\n([\s\S]*?)```/;

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
  readonly inputFiles?: readonly SandboxInputFile[];
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

    /*
     * ── 2026-09-06 实测事故：这一轮没有脚本块，不等于"这次执行失败了" ──
     *
     * 症状（devapp，通用助手，用户要一份中文 PDF）：用户看到的失败原因是
     * `model reply contained no fenced script block; reply was: 我已经把…整理成了一份 PDF…`，
     * 也就是一句**关于回复格式的内部抱怨**，而第 1 次尝试真正拿到的沙箱 stderr
     * 不见了。两个独立的缺陷叠在一起：
     *
     * ① 缺块直接终止：`extractScript` 抛的是终态错误，循环当场结束。可模型漏写围栏
     *    是**可纠正**的——回喂里明确要求"只回一个 run_script 块"通常一次就好。以前
     *    它连一次纠正的机会都没有。
     * ② 真因被覆盖：那个终态错误的 `lastStderr` 是这句格式抱怨，而不是 `history`
     *    里已经记下的、上一次**真实**的沙箱 stderr。#660 / #1611 记过两次的同一条
     *    纪律（失败必须带回真因）在这条缝里失效了——真因照样消失，只是换了个姿势。
     *
     * ⇒ 缺块按"这一次尝试失败了"处理：记进 history、给一条纠正性回喂、继续下一次。
     *   重试用尽时抛出的仍然是 `history` 里**最后一次真实沙箱 stderr**（见循环之后），
     *   格式抱怨只在从头到尾一个脚本都没跑过时才是真因本身。
     */
    const extracted = tryExtractScript(raw);
    if (extracted === null) {
      history.push({ attempt, exitCode: null, stderr: noScriptBlockMessage(raw) });
      deps.log?.("skill trial run reply contained no script block", {
        attempt,
        replyExcerpt: excerpt(raw),
      });
      feedback = [
        "Your reply contained no runnable script block, so nothing was executed.",
        "",
        "Do not describe the file or claim it was produced — it was not.",
        `Reply with exactly one ${SCRIPT_FENCE_OPEN} block containing the complete Node.js script,`,
        "and nothing else.",
      ].join("\n");
      continue;
    }
    const script = extracted;

    // ⚠ 沙箱不可达时**立刻**抛出，不消耗重试次数：重试只对"脚本写错了"有意义，
    //   对"服务挂了"重试三次只会让一次运维故障被报成 SCRIPT_FAILED_AFTER_RETRIES。
    const result = await deps.sandbox.run({ script, timeoutMs: deps.timeoutMs, ...(deps.inputFiles ? { inputFiles: deps.inputFiles } : {}) });

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

  /*
   * ⚠ 报**最后一次真的跑起来过**的失败，而不是简单地取 history 的最后一条。
   *
   * 最后一次尝试很可能是"模型这轮没给脚本块"（上面那段的 ① ②）——把它当真因报出去，
   * 就是用一句关于回复格式的内部抱怨盖掉沙箱返回的真实 stderr。只有从头到尾一个
   * 脚本都没被执行过时，"没有脚本块"才**是**真因本身。
   */
  const executed = history.filter((record) => record.exitCode !== null);
  const last = (executed.length > 0 ? executed[executed.length - 1] : history[history.length - 1])!;
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
  const fenced = SCRIPT_FENCE_RE.exec(reply);
  if (fenced?.[1] !== undefined && fenced[1].trim() !== "") return fenced[1];
  throw new ScriptFailedAfterRetriesError(1, noScriptBlockMessage(reply), null);
}

/** 「这轮回复里没有脚本块」的唯一文案——循环里与 `extractScript` 共用，不写两份。 */
function noScriptBlockMessage(reply: string): string {
  return `model reply contained no fenced script block; reply was:\n${excerpt(reply)}`;
}

/**
 * `extractScript` 的**不抛版本**（#1624）。
 *
 * chat 那条路径要先回答一个 `extractScript` 回答不了的问题：**这次回复里到底有没有脚本**。
 * `extractScript` 把"没有"表达成抛 `ScriptFailedAfterRetriesError`——那在试跑里是对的
 * （试跑就是为了执行，没脚本就是失败），但在 chat 里"模型这轮只是在说话"是**绝大多数
 * 情况**，不是失败。用 try/catch 把常态当异常走，既贵又容易把真正的失败一起吞掉。
 *
 * ⚠ 两者共用同一条正则常量，**不复制第二份解析规则**——同一事实两处声明是本仓栽过五次的坑。
 */
export function tryExtractScript(reply: string): string | null {
  const fenced = SCRIPT_FENCE_RE.exec(reply);
  return fenced?.[1] !== undefined && fenced[1].trim() !== "" ? fenced[1] : null;
}

function excerpt(text: string): string {
  return text.length <= FEEDBACK_EXCERPT_CHARS
    ? text
    : `${text.slice(0, FEEDBACK_EXCERPT_CHARS)}\n...[truncated]`;
}
