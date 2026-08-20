/**
 * `maybeRunSkillScript` —— 把**已经在试跑那条链上跑通的**沙箱执行接到 chat（#1624）。
 *
 * ## 在这之前 chat 里的 `#pptx` 是什么样的（实测，不是推测）
 *
 * `execute-run.ts` 对 skill 只做 `readPinnedSkills` → `buildSystemPrompt` → `complete()`，
 * 也就是**把 skill 正文塞进 system prompt**。`git grep -c "SkillSandbox|runScriptWithRetries"`
 * 在那个文件上的结果是 **0**。于是模型会**讲**怎么用 pptxgenjs 做一个 deck，甚至把代码
 * 原样贴出来——但没有任何一处去跑它，用户拿不到文件。缺的从来不是提示词，是执行。
 *
 * ## 触发判据：三个条件同时成立才执行（本文件唯一的"决定"）
 *
 * | 条件 | 为什么 |
 * |---|---|
 * | `deps.sandbox` 与 `deps.objects` 都注入了 | 没注入 ⇒ 这条路径整段不存在，行为与今天**逐字节相同**（T2） |
 * | 这次 run **挂了至少一个 skill** | 没挂 skill 的普通对话不该因为模型随口贴了段 js 就被拿去执行 |
 * | `tryExtractScript(reply)` 真的抠到了脚本 | 模型这轮只是在说话 ⇒ 什么都不做 |
 *
 * ⚠ **为什么不是"挂了 skill 就执行"**：挂着 pptx skill 问一句"你都能做什么"，模型会
 *   回一段说明文字。恒真判据会把那段散文喂给 node，产生一堆与真实问题无关的语法错误，
 *   然后把一条本来完好的回复变成三次失败重试 + 一条满是 stderr 的消息。判据必须由
 *   **模型这一轮是否真的产出了可执行块**决定，而不是由配置决定。
 *
 * ⚠ **为什么不是"回复里有代码块就执行"**：没挂任何 skill 的对话里，「帮我写个快排」
 *   会得到一个 ```js 块——那是给人看的答案，不是要求执行。挂载是用户的显式意图信号。
 *
 * 反证（T3-CP）：把判据改成恒真，T3 必须变红。
 *
 * ## 第一次尝试**不额外调模型**
 *
 * `execute-run.ts` 已经为这一轮调过一次 `complete()` 并拿到了 `reply`。这里把那份
 * 回复当作 `runScriptWithRetries` 的第 1 次 `generateScript` 结果直接复用，只有**失败
 * 回喂**才真的再调模型。否则同一句用户消息会产生两次首轮计费调用，而第二次的回复
 * 还可能与已经写回给用户的那条正文不一致——用户看到的字和真正被执行的脚本对不上。
 *
 * ## 失败必须带回真实 stderr（#660 / #1611 记过两次的同一条）
 *
 * 脚本三次都跑不出来时，用户看到的是**真实的 exitCode 与 stderr 原文**，不是
 * 「生成失败，请重试」。把真因翻译成一句安慰话，等于把唯一能定位问题的信息销毁掉，
 * 而"请重试"对一个每次都会同样失败的脚本是纯粹的谎言。T4 直接断言消息里
 * **不匹配** `/请重试|please try again/i`。
 *
 * ## 产物走既有的**聊天附件**通路，不新造第三套产物语义
 *
 * 字节 `ObjectStore.putOnce`（与试跑 `execute-trial-run.ts` 逐字同一条），引用作为
 * `ProducedFile` 交回调用方，由 #413 写回事务把它挂成助手消息的附件——
 * 复用 #946 已经上线的 `chat_attachments` + `GET .../attachments/:id/content` 下载路由，
 * 前端的消息附件渲染与鉴权（线程可见性）一行都不用改。
 *
 * ⚠ 特意**不**走 `land-as-artifact`：那条路要一个**已经存在的** `messageId`（助手消息此刻
 *   还没写回），且它的 `parts` 是写死的 `content.md` + `provenance.json` 两个文本文件，
 *   塞不进一个二进制 .pptx。硬改它会把 UC-20 的落地产物语义一起改掉——那是另一件事。
 *   用户要把这个 .pptx 留成项目产物，仍然走既有的显式落地操作。
 */
import type { ObjectStore } from "../artifact/ports";
import type { RunOutputFile } from "./ports";
import {
  MAX_SCRIPT_ATTEMPTS,
  ScriptFailedAfterRetriesError,
  SandboxTimeoutError,
  runScriptWithRetries,
  tryExtractScript,
} from "../skill/run-script-with-retries";
import { SandboxUnavailableError, type SkillSandboxPort } from "../skill/skill-sandbox-port";

/** 沙箱单次执行的 wall-clock 上限。与试跑同值——同一条执行语义不该有两个超时。 */
export const CHAT_SCRIPT_TIMEOUT_MS = 120_000;

/**
 * 按扩展名给 mime。与 `execute-trial-run.ts` 的表**同形**：首个切片只做 deck，
 * 认不出的一律 `application/octet-stream`（诚实的"不知道"，不猜一个像样的类型）。
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * 沙箱执行产出的一个文件，字节已落对象存储。
 *
 * ⚠ 就是 `ports.ts` 的 `RunOutputFile` 本身，不是它的第二份副本——这个形状要一路走到
 * `commitWriteback` 的附件插入，两处各声明一次必然漂移（本仓栽过五次的同一条）。
 */
export type ProducedFile = RunOutputFile;

export type SkillScriptOutcome =
  /** 判据不成立 ⇒ 一次都没碰沙箱。`text` 恒为传进来的 `reply` 本身。 */
  | { readonly kind: "not_attempted"; readonly text: string; readonly files: readonly [] }
  | {
    readonly kind: "succeeded";
    readonly text: string;
    readonly files: readonly ProducedFile[];
    readonly attempts: number;
  }
  /** 执行确实发生过、确实失败了。`text` 里带**真实** stderr。 */
  | {
    readonly kind: "failed";
    readonly text: string;
    readonly files: readonly [];
    readonly failureCode: "SANDBOX_UNAVAILABLE" | "SANDBOX_TIMEOUT" | "SCRIPT_FAILED_AFTER_RETRIES";
    readonly stderr: string;
  };

export interface MaybeRunSkillScriptDeps {
  /** 缺省 ⇒ 整条路径不存在（T2 的不回归保证）。 */
  readonly sandbox?: SkillSandboxPort;
  /** 同上：没有落字节的地方，产出的文件无处可去，不如根本不执行。 */
  readonly objects?: ObjectStore;
  /** 失败回喂时重新问模型要一版脚本。第 1 次**不**走这里（复用已有回复）。 */
  readonly regenerate: (feedback: string) => Promise<string>;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  /** 对象键前缀。带 runId ⇒ 天然不撞键，`putOnce` 的 never-overwrite 不会被重试绕过。 */
  readonly objectKeyFor?: (fileName: string) => string;
}

export interface MaybeRunSkillScriptInput {
  readonly runId: string;
  /** 本次 run 钉住的 skill 版本数。0 ⇒ 不执行。 */
  readonly pinnedSkillCount: number;
  /** 模型这一轮的完整回复。 */
  readonly reply: string;
}

export async function maybeRunSkillScript(
  deps: MaybeRunSkillScriptDeps,
  input: MaybeRunSkillScriptInput,
): Promise<SkillScriptOutcome> {
  const notAttempted = { kind: "not_attempted", text: input.reply, files: [] } as const;

  // ── 判据（见头注的表）。三条任一不成立就原样返回，沙箱一次都不被调用。 ──
  if (!deps.sandbox || !deps.objects) return notAttempted;
  if (input.pinnedSkillCount <= 0) return notAttempted;
  if (tryExtractScript(input.reply) === null) return notAttempted;

  const sandbox = deps.sandbox;
  const objects = deps.objects;

  try {
    const loop = await runScriptWithRetries({
      sandbox,
      timeoutMs: deps.timeoutMs ?? CHAT_SCRIPT_TIMEOUT_MS,
      maxAttempts: deps.maxAttempts ?? MAX_SCRIPT_ATTEMPTS,
      log: deps.log,
      // 第 1 次复用已有回复（feedback === null），之后才真的再调模型。
      generateScript: async (feedback) => (feedback === null ? input.reply : deps.regenerate(feedback)),
    });

    const files: ProducedFile[] = [];
    for (const file of loop.files) {
      const bytes = Buffer.from(file.contentBase64, "base64");
      const key = deps.objectKeyFor
        ? deps.objectKeyFor(file.name)
        : `agent-run-outputs/${input.runId}/${file.name}`;
      const dot = file.name.lastIndexOf(".");
      const mime = (dot === -1 ? undefined : MIME_BY_EXTENSION[file.name.slice(dot).toLowerCase()])
        ?? "application/octet-stream";
      await objects.putOnce(key, bytes, mime);
      files.push({ name: file.name, mime, sizeBytes: bytes.length, objectKey: key });
    }

    deps.log("chat run executed skill script", {
      runId: input.runId, attempts: loop.attempts, fileCount: files.length,
    });

    return { kind: "succeeded", text: renderSuccess(input.reply, files), files, attempts: loop.attempts };
  } catch (e) {
    const failure = toFailure(e);
    deps.log("chat run skill script execution failed", {
      runId: input.runId, code: failure.failureCode, stderrExcerpt: failure.stderr.slice(0, 500),
    });
    return {
      kind: "failed",
      text: renderFailure(input.reply, failure.failureCode, failure.stderr),
      files: [],
      failureCode: failure.failureCode,
      stderr: failure.stderr,
    };
  }
}

function toFailure(e: unknown): {
  readonly failureCode: "SANDBOX_UNAVAILABLE" | "SANDBOX_TIMEOUT" | "SCRIPT_FAILED_AFTER_RETRIES";
  readonly stderr: string;
} {
  if (e instanceof SandboxUnavailableError) {
    return { failureCode: "SANDBOX_UNAVAILABLE", stderr: e.detail };
  }
  if (e instanceof SandboxTimeoutError) {
    return { failureCode: "SANDBOX_TIMEOUT", stderr: "" };
  }
  if (e instanceof ScriptFailedAfterRetriesError) {
    // ⚠ 原样带回，不加工（#660）。
    return { failureCode: "SCRIPT_FAILED_AFTER_RETRIES", stderr: e.lastStderr };
  }
  // 兜底也如实报——一个意外异常确实是"这条执行链上出了没预料到的问题"。
  return {
    failureCode: "SANDBOX_UNAVAILABLE",
    stderr: e instanceof Error ? `${e.name}: ${e.message}` : "unexpected script execution failure",
  };
}

/**
 * 成功文案。
 *
 * ⚠ **保留模型原文**，只在后面追加一段事实说明。不去把脚本块从正文里剪掉：那等于
 *   替模型改写它说过的话，而用户看到的字与真正被执行的脚本从此对不上——审计时
 *   `outputDigest` 指向的文本里再也找不到那段脚本。
 */
function renderSuccess(reply: string, files: readonly ProducedFile[]): string {
  if (files.length === 0) {
    // 脚本退出码 0 但一个文件都没写。**不谎称成功产出**。
    return `${reply}\n\n---\n\n⚠ 脚本执行成功（退出码 0），但没有向输出目录写入任何文件，因此这轮没有可下载的产物。`;
  }
  const list = files.map((f) => `- ${f.name}（${f.sizeBytes} 字节）`).join("\n");
  return `${reply}\n\n---\n\n已在沙箱中执行上面的脚本，生成以下文件（见本条消息的附件）：\n${list}`;
}

/**
 * 失败文案。
 *
 * ⚠ 这里是 #660 / #1611 两次事故的落点：**真实 stderr 原样出现**，不翻译成
 *   「生成失败，请重试」。T4 断言这段文本里出现 stderr 原文、且**不**匹配
 *   `/请重试|please try again/i`。
 */
function renderFailure(reply: string, code: string, stderr: string): string {
  const detail = stderr.trim() === "" ? "（沙箱未返回 stderr）" : stderr;
  return [
    reply,
    "",
    "---",
    "",
    `⚠ 脚本执行失败（${code}），本轮**没有**产出文件。沙箱返回的真实错误输出：`,
    "",
    "```",
    detail,
    "```",
  ].join("\n");
}
