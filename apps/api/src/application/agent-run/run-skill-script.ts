import { assertCurrentRunLease } from "./run-lease";
import type { SandboxInputFile } from "@repo/skill-sandbox/input-files";
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
 * | `reply` 或任一 `scriptSources` 里真的抠到了脚本 | 模型这轮只是在说话 ⇒ 什么都不做 |
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
 * ## #1747：deep-agent 那条路的脚本不在最终回复里
 *
 * 走 `通用助手`（`DeepAgentModelProvider`）时，最终 AI 消息是编排模型对 `call_skill`
 * 结果的转述散文；子模型写出来的脚本块留在 `ToolMessage` 里，从来没进过被检查的那段
 * 文本。所以判据的第三条从「reply 里有脚本」放宽到「reply 或任一候选来源里有脚本」，
 * 候选来源由 provider 通过 `ModelCallCompletion.scriptCandidates` 交上来。
 *
 * ⚠ 放宽的只是**去哪儿找脚本**，不是**什么时候可以执行**：前两条判据（注入了沙箱与
 *   对象存储 ∧ 这轮挂了 skill）一个字没动。没挂 skill 的对话仍然一次都不碰沙箱。
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
import { outputFileMime } from "./output-file-mime";
import { ObjectExistsError, type ObjectStore } from "../artifact/ports";
import { ModelCallError, ModelCallInterruptedError, type ModelCallCompletion, type RunOutputFile } from "./ports";
import {
  MAX_SCRIPT_ATTEMPTS,
  ScriptFailedAfterRetriesError,
  ScriptProducedNoFilesError,
  SandboxTimeoutError,
  runScriptWithRetries,
  tryExtractScript,
} from "../skill/run-script-with-retries";
import { SandboxUnavailableError, type SkillSandboxPort } from "../skill/skill-sandbox-port";

/** 沙箱单次执行的 wall-clock 上限。与试跑同值——同一条执行语义不该有两个超时。 */
export const CHAT_SCRIPT_TIMEOUT_MS = 120_000;

/**
 * 沙箱执行产出的一个文件，字节已落对象存储。
 *
 * ⚠ 就是 `ports.ts` 的 `RunOutputFile` 本身，不是它的第二份副本——这个形状要一路走到
 * `commitWriteback` 的附件插入，两处各声明一次必然漂移（本仓栽过五次的同一条）。
 */
export type ProducedFile = RunOutputFile;

class ScriptCancelledAtBoundary extends Error {}

/**
 * 一次脚本执行失败的**归类**。
 *
 * ⚠ 只声明在这里一处：`SkillScriptOutcome` 与 `toFailure` 原来各写了一份同样的字面量
 *   联合，加一个码要改两处，漏一处就是一条只在某一侧存在的契约（本仓「同一事实声明
 *   在两处」栽过五次的同一个形状）。
 */
export type SkillScriptFailureCode =
  | "SANDBOX_UNAVAILABLE"
  | "SANDBOX_TIMEOUT"
  | "SCRIPT_FAILED_AFTER_RETRIES"
  /** #2718 F13：回喂重试时 `regenerate` 触发的模型调用本身失败（与"脚本写错了"
   *  或"沙箱挂了"是两件事，运维该去查的地方也不同——见 `toFailure` 的分支）。 */
  | "MODEL_CALL_FAILED"
  /** issue #2893：回喂重试时内核停在 interrupt（自己发起 HITL 工具等人裁决）。
   *  与 `MODEL_CALL_FAILED` 是两件事——调用没有失败，是它在等一个人回答问题，
   *  运维去查模型/内核故障只会一无所获。 */
  | "SCRIPT_RETRY_INTERRUPTED"
  /**
   * 脚本跑通了（退出码 0）却一个文件都没写。
   *
   * 2026-09-24 真实模型实测：人类要「深度研究…然后生成一个 ppt」，这一轮跑了 429 秒、
   * 退出码 0、界面**全程没有错误横幅**，而产出文件卡数量为 0——用户什么也没拿到，
   * 系统却认为成功。它与 `SCRIPT_FAILED_AFTER_RETRIES` 是两个成因：那个是脚本报错，
   * 这个是脚本忘了往 `SKILL_SANDBOX_OUT_DIR` 写。混成一个会让排查往「脚本哪里写错了」
   * 跑，而真相是「它从来没往输出目录写东西」。
   */
  | "SCRIPT_PRODUCED_NO_FILES"
  /** 诚实的兜底：分类器认不出这个异常属于以上哪一类时用这个,不得借用一个具体但
   *  错误的分类顶替（R7，`requirements/05-error-observability.md`）。 */
  | "UNKNOWN_EXECUTION_ERROR";

export type SkillScriptOutcome =
  | { readonly kind: "cancelled"; readonly text: string; readonly files: readonly [] }
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
    readonly failureCode: SkillScriptFailureCode;
    readonly stderr: string;
  };

export interface MaybeRunSkillScriptDeps {
  /** 缺省 ⇒ 整条路径不存在（T2 的不回归保证）。 */
  readonly sandbox?: SkillSandboxPort;
  readonly cancelAtCheckpoint?: () => Promise<boolean>;
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
  readonly inputFiles?: readonly SandboxInputFile[];
  readonly runId: string;
  /** 本次 run 钉住的 skill 版本数。0 ⇒ 不执行。 */
  readonly pinnedSkillCount: number;
  /** 模型这一轮的完整回复。 */
  readonly reply: string;
  /**
   * #1747 —— 除最终回复之外的**候选脚本来源**（`ModelCallCompletion.scriptCandidates`）。
   *
   * 为什么需要它：走 deep-agent 的 run，最终回复是编排模型对 `call_skill` 结果的转述，
   * 真正的脚本块留在工具结果里。判据只看 `reply` 时，挂了 skill 的 deep-agent run 会
   * 一路 succeeded 却 0 文件——#1747 的实测形态。
   *
   * ⚠ 缺省/空数组 ⇒ 判据与执行路径与本次改动之前**逐字节相同**（T2 的保证之一）。
   * ⚠ 只影响「拿哪段文本去解析脚本」。写回给用户的正文永远是 `reply`，不是这里的候选——
   *   工具结果是链路中间产物，把它贴给用户等于让用户看到两份互相矛盾的答案。
   */
  readonly scriptSources?: readonly string[];
}

/**
 * 回喂重试拿回来的一次 completion → **拿去解析脚本的那段文本**。
 *
 * 原来内联在 `execute-run.ts` 的 `regenerate` 里；issue #2893 把它挪到这里，理由是
 * 这条规则的两个分支（下面两段）最终都由**本文件**归类与写文案，规则与消费者隔一个
 * 文件放着，改一边漏一边就是一条只在半路上成立的契约。
 *
 * ## #1747 —— 也要去工具结果里找脚本，理由与第一次尝试逐字相同
 *
 * 少了这一条，deep-agent 那条路的失败诚实性会被悄悄换掉：第 1 次跑的是工具结果里的
 * 真脚本、真的失败了、拿到了真的 stderr；第 2 次却因为最终回复里没有代码围栏而以
 * 「model reply contained no fenced script block」终止——用户看到的就不再是沙箱返回的
 * 真实错误，而是一句关于回复格式的内部抱怨。真因照样消失，只是换了个消失的姿势
 * （#660 / #1611 那条纪律的同一个缺口）。
 *
 * 一个候选都没有时**退回 `retry.text`**，让循环照常报它那条诚实的「这次回复里根本
 * 没有脚本」——不在这里替它编一个空脚本。
 *
 * ## issue #2893 —— 停在 interrupt 的 completion 不是"这轮没写脚本"
 *
 * 内核可能在**脚本重生成**这一步自己发起 `confirm_task_intent` / `fill_run_params`
 * 停下来等人回答。这种 completion 的 `text` 是空串（见 `ModelCallCompletion.interrupted`
 * 的头注：必须先查这个字段再判空文本）。不在这里认出来，它就会伪装成「模型这轮没给
 * 脚本块」，让重试循环把剩下的次数全花在一个已经停住等人的线程上，最后报一个与真实
 * 处境无关的失败。走轮询的 provider 抛 `ModelCallInterruptedError`、走流式的返回
 * `interrupted` 摘要——两种形态在这里收敛成**同一个事实**。
 *
 * ⚠ 待批工具名只进异常的 `detail`（服务端日志），不进用户文案：那是内核的内部工具名。
 */
/**
 * 同一个键上的重复写入：**这一个键的形状**（`runId` + 文件名）天然只可能来自同一次
 * call_skill 意图的重复交付，不是两份互不相干的产物抢同一个名字——所以撞键本身
 * 就该当作幂等重试，不该按字节比对来决定放不放行。
 *
 * 2026-09-25 原生 deep-agent 链路实测两轮才把这件事看全：
 *
 * ① 第一轮：`call_skill` 被编排层重试，沙箱第二次又跑出"同一份"文件，`putOnce` 的
 *    never-overwrite 把这次**成功的重试**判成失败，run 以 `UNKNOWN_EXECUTION_ERROR`
 *    死掉。第一版修法是"读回来比对字节，一致才放行"。
 * ② 第二轮：那个修法看着对，实测**仍然**崩在同一个错误上——反证用同一段 pptxgenjs
 *    脚本连跑两次，产物字节从第 11 个字符就不同（OOXML 的 core.xml 里带创建/修改
 *    时间戳）。也就是说 pptx/docx/xlsx 这类格式**永远不会**字节相同，"比对字节"这
 *    道门槛实际上从没放行过一次，所有原生链路上的 Office 撞键都照旧硬失败。
 *
 * 结论：字节比对在这个场景下是个假门槛——它精确地卡住了它本该放行的那一类情况。
 * 真正该问的问题不是"两次产物是不是一模一样"，而是"这个键的形状是不是只可能来自
 * 同一次意图"：`agent-run-outputs/${runId}/${fileName}` 里 runId 天然只属于这一次
 * chat run，同一轮内两次写向同一个文件名，唯一合理的解释就是重试或修订，不是两个
 * 互不相干的产物撞名——那种情况从设计上就不会发生（不同产物不会自己选中同一个
 * 文件名）。所以这里**不再比对内容**，撞键即视为幂等：保留先到的那一份，放行。
 * 用户体感是"文件在"，不是"哪一次尝试的文件"——多次尝试里只要有一次真的成功过，
 * run 就该算成功。
 */
async function putOnceIdempotent(
  objects: ObjectStore,
  key: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  try {
    await objects.putOnce(key, bytes, mime);
  } catch (error) {
    if (!(error instanceof ObjectExistsError)) throw error;
  }
}

export function retryScriptSource(
  retry: Pick<ModelCallCompletion, "text" | "scriptCandidates" | "interrupted">,
): string {
  if (retry.interrupted) {
    throw new ModelCallInterruptedError(
      `script regeneration stopped at a kernel interrupt (${retry.interrupted.toolName})`,
    );
  }
  const candidates = [retry.text, ...(retry.scriptCandidates ?? [])];
  return candidates.find((candidate) => tryExtractScript(candidate) !== null) ?? retry.text;
}

export async function maybeRunSkillScript(
  deps: MaybeRunSkillScriptDeps,
  input: MaybeRunSkillScriptInput,
): Promise<SkillScriptOutcome> {
  /*
   * ⚠ 先把「模型把我们的系统提示复述了一遍」这种回复挡掉，再往下走。
   *
   * 2026-09-24 真实模型实测：人类要「深度研究…然后生成一个 ppt」，屏幕上出现的是
   * **66149 字的技能内部协议**——`run_script` 协议块、
   * 「The sandbox has NO network access」、画布模板的「条数上限〔分区名=N条〕」规则。
   * 证据 apps/web/test-results/real-model-evidence/90-final-screen.png（肉眼确认）。
   *
   * 泄漏路径不是某一处：`input.reply` 在下面**四个**出口（成功 / 失败 / 取消 / 未尝试）
   * 都会原样交给用户，所以收敛在入口一次，而不是每个出口各补一次。
   */
  const reply = withoutProtocolEcho(input.reply);
  const notAttempted = { kind: "not_attempted", text: reply, files: [] } as const;

  // ── 判据（见头注的表）。三条任一不成立就原样返回，沙箱一次都不被调用。 ──
  if (!deps.sandbox || !deps.objects) return notAttempted;
  if (input.pinnedSkillCount <= 0) return notAttempted;
  // 第三条：`reply` 优先，其次才是 #1747 的候选来源。顺序有意义——模型这轮**自己**写出来
  // 的脚本，与写回给用户的正文是同一段文字；候选来源是链路中间产物，只在正文里确实没有
  // 脚本时才用得上。`scriptSources` 缺省 ⇒ 这一行退化成改动前的那一行。
  // A deep-agent turn may call more than one file skill (for example docx-create and
  // pptx-create). Each ToolMessage is a separate candidate. The old `.find()` silently
  // discarded every candidate after the first, so the run could claim both formats while
  // only one script ever reached the sandbox. Deduplicate the extracted script bodies
  // because an orchestrator may also repeat a tool result in its final reply.
  const scriptSources: string[] = [];
  const seenScripts = new Set<string>();
  for (const candidate of [input.reply, ...(input.scriptSources ?? [])]) {
    const script = tryExtractScript(candidate);
    if (script === null || seenScripts.has(script)) continue;
    seenScripts.add(script);
    scriptSources.push(candidate);
  }
  if (scriptSources.length === 0) return notAttempted;

  const sandbox = deps.sandbox;
  const objects = deps.objects;

  const checkCancellation = async () => {
    if (await deps.cancelAtCheckpoint?.()) throw new ScriptCancelledAtBoundary();
  };
  try {
    const loops = [];
    for (const scriptSource of scriptSources) {
      loops.push(await runScriptWithRetries({
        sandbox: { run: async (request) => { await checkCancellation(); return sandbox.run(request); } },
        timeoutMs: deps.timeoutMs ?? CHAT_SCRIPT_TIMEOUT_MS,
        maxAttempts: deps.maxAttempts ?? MAX_SCRIPT_ATTEMPTS,
        inputFiles: input.inputFiles,
        log: deps.log,
        // Each candidate's first attempt reuses its own tool result. A failed candidate
        // alone asks the model for a correction; already successful siblings are not rerun.
        generateScript: async (feedback) => {
          await checkCancellation();
          return feedback === null ? scriptSource : deps.regenerate(feedback);
        },
      }));
    }

    const files: ProducedFile[] = [];
    for (const file of loops.flatMap((loop) => loop.files)) {
      const bytes = Buffer.from(file.contentBase64, "base64");
      const key = deps.objectKeyFor
        ? deps.objectKeyFor(file.name)
        : `agent-run-outputs/${input.runId}/${file.name}`;
      const mime = outputFileMime(file.name);
      await assertCurrentRunLease();
      await putOnceIdempotent(objects, key, bytes, mime);
      files.push({ name: file.name, mime, sizeBytes: bytes.length, objectKey: key });
    }

    deps.log("chat run executed skill script", {
      runId: input.runId,
      scriptCount: loops.length,
      attempts: loops.reduce((sum, loop) => sum + loop.attempts, 0),
      fileCount: files.length,
    });

    return {
      kind: "succeeded", text: renderSuccess(reply, files), files,
      attempts: loops.reduce((sum, loop) => sum + loop.attempts, 0),
    };
  } catch (e) {
    if (e instanceof ScriptCancelledAtBoundary) return { kind: "cancelled", text: reply, files: [] };
    const failure = toFailure(e);
    deps.log("chat run skill script execution failed", {
      runId: input.runId, code: failure.failureCode, stderrExcerpt: failure.stderr.slice(0, 500),
      /*
       * issue #2893 —— 用户文案不再外露内部字符串（见 `renderFailure`），那句内部措辞
       * 就必须在**这里**落地，否则它只是被删掉了：排查的人既看不到用户那条消息里的
       * 原话，日志里也没有。`detail` 本来就是 `ModelCallError` 头注指定的去处
       * （"for the SERVER LOG only"）。
       */
      ...(e instanceof ModelCallError ? { modelCallDetail: e.detail } : {}),
    });
    return {
      kind: "failed",
      text: renderFailure(reply, failure.failureCode, failure.stderr),
      files: [],
      failureCode: failure.failureCode,
      stderr: failure.stderr,
    };
  }
}

function toFailure(e: unknown): {
  readonly failureCode: SkillScriptFailureCode;
  readonly stderr: string;
} {
  if (e instanceof SandboxUnavailableError) {
    return { failureCode: "SANDBOX_UNAVAILABLE", stderr: e.detail };
  }
  if (e instanceof SandboxTimeoutError) {
    return { failureCode: "SANDBOX_TIMEOUT", stderr: "" };
  }
  if (e instanceof ScriptProducedNoFilesError) {
    // 没有 stderr 可报——沙箱这几次都跑通了，问题在"没写文件"这件事本身。
    return { failureCode: "SCRIPT_PRODUCED_NO_FILES", stderr: "" };
  }
  if (e instanceof ScriptFailedAfterRetriesError) {
    // ⚠ 原样带回，不加工（#660）。
    return { failureCode: "SCRIPT_FAILED_AFTER_RETRIES", stderr: e.lastStderr };
  }
  /*
   * issue #2893 —— 内核在**脚本重生成**这一步停在 interrupt（它自己发起
   * `confirm_task_intent` / `fill_run_params` 之类的 HITL 工具，等人回答）。
   *
   * 实测形态：pptx 脚本第一次在沙箱失败（环境缺模块）→ 回喂重试 → 重生成的那个 run
   * 停在 interrupt → 用户看到的是
   * 「脚本执行失败（MODEL_CALL_FAILED）……沙箱返回的真实错误输出：deep agent run
   * ended with status "interrupted"」。那句话里**没有一个字是真的**：不是沙箱返回的，
   * 沙箱这一次根本没被调用；也不是一次失败的模型调用，是它在等人。
   *
   * ⚠ 分支必须排在下面的 `ModelCallError` 之前：`ModelCallInterruptedError` 是它的
   *   子类（见 `ports.ts` 那个类为什么这么定义），顺序反了就会先被父类分支吃掉——
   *   与本文件下面那条「`ModelCallError` 必须排在兜底之前」逐字同一个坑。
   */
  if (e instanceof ModelCallInterruptedError) {
    // stderr 恒为空串：这一路**没有**沙箱输出，编一个或把内核状态塞进这个字段，
    // 就是把「沙箱说了什么」这个事实伪造出来（#660 / #1611 那条纪律的反面）。
    return { failureCode: "SCRIPT_RETRY_INTERRUPTED", stderr: "" };
  }
  /*
   * #2718 F13 —— 回喂重试的 `deps.regenerate(feedback)` 是一次真正的模型调用
   * （见 `execute-run.ts` 接线：`deps.model.complete(...)`），失败时抛的是
   * `ModelCallError`，不是沙箱端口的异常。改前这里落进下面的兜底，被诚实地跑
   * 起来的一次模型故障就此被记成 `SANDBOX_UNAVAILABLE`——运维会去查一个没坏的
   * 沙箱容器，而真正出问题的模型调用无人知晓（本 phase 触发 bug 的诱因之一）。
   * ⚠ 分支必须排在下面的兜底之前：`ModelCallError` 同样是"意外到达这里的异常"，
   *   顺序反了就会先被兜底吃掉。
   */
  if (e instanceof ModelCallError) {
    return { failureCode: "MODEL_CALL_FAILED", stderr: e.detail };
  }
  // 真正的兜底：分类器认不出这个异常属于以上哪一类。R7——宁可诚实地说"不知道"，
  // 也不能张冠李戴地扣一个具体但错误的分类（这条纪律本身就是本次修复的诱因）。
  return {
    failureCode: "UNKNOWN_EXECUTION_ERROR",
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
 *
 * ⚠ issue #2893 在同一段文字上发现了**反方向**的一条：这段文案原来对**每一种**失败
 *   都说「沙箱返回的真实错误输出：」，然后把 `stderr` 字段原样贴出来。可这个字段只在
 *   沙箱真的跑过时才装着沙箱的话；模型调用失败那一路装的是 `ModelCallError.detail`，
 *   而那按 `ports.ts` 的纪律是**只进服务端日志**的内部字符串。于是实测里用户看到的是
 *   「沙箱返回的真实错误输出：deep agent run ended with status "interrupted"」——
 *   一句既不是沙箱说的、也不是给用户看的话，被一个"诚实"的标签背书成了真因。
 *   **说出真因**与**把内部状态原样倒给用户**不是同一件事；来源不同，文案就必须不同。
 */
/**
 * 只存在于**我们自己的系统提示**里的串。用户可见的回答里出现它们，只有一种解释：
 * 模型把提示复述回来了。
 *
 * ⚠ 判据要**两条以上同时命中**才动手。单条容易误伤——用户完全可能在正常回答里
 * 提到「沙箱」或某个变量名；而复述整份协议时这些串是成片出现的。
 * 宁可漏掉一次轻微泄漏，也不要把一条正常回答掐掉（后者用户立刻就会发现，且无从申诉）。
 */
const PROTOCOL_MARKERS = [
  "SKILL_SANDBOX_OUT_DIR",
  "The sandbox has NO network access",
  "Write every file you want to return into",
  "reply with exactly one fenced block",
  "模板: <key>",
] as const;

/** 复述被挡掉时，留给用户的一句话——不留空白，也不假装那段内容是答案。 */
const PROTOCOL_ECHO_NOTICE =
  "（这一轮模型没有给出可用的回答，而是复述了内部执行说明，已省略。请再说一次你要的内容，我重试一次。）";

export function withoutProtocolEcho(reply: string): string {
  const hits = PROTOCOL_MARKERS.filter((marker) => reply.includes(marker)).length;
  return hits >= 2 ? PROTOCOL_ECHO_NOTICE : reply;
}

function renderFailure(reply: string, code: SkillScriptFailureCode, stderr: string): string {
  return [reply, "", "---", "", ...failureBody(code, stderr)].join("\n");
}

/** 按失败**来源**给文案，不按"有没有字符串可贴"。 */
function failureBody(code: SkillScriptFailureCode, stderr: string): readonly string[] {
  switch (code) {
    case "SCRIPT_RETRY_INTERRUPTED":
      /*
       * 沙箱在这一步根本没被调用（失败发生在"再问模型要一版脚本"这一步，而那次
       * 请求停在了等人裁决上）。既没有沙箱输出可报，也不把内核状态原样外露——
       * 内部措辞由 `deps.log` 带进服务端日志，用户这里只留下**他能据以行动**的事实。
       */
      return [
        "⚠ 重新生成脚本时运行被中断（在等待一次人工确认），本轮**没有**产出文件。",
        "这一步没有执行沙箱，因此没有沙箱输出可报。补充说明你要的产物后可以继续。",
      ];
    case "SCRIPT_PRODUCED_NO_FILES":
      /*
       * 沙箱跑通了，所以没有 stderr 可贴；用户需要的不是"错误输出"，
       * 是知道**这一轮没有东西可下载**，以及下一步能做什么。
       */
      return [
        "⚠ 这一轮生成脚本执行成功，但没有写出任何文件，因此**没有**可下载的产物。",
        "可以再说一次你要的文件类型与内容要点（例如「做一个 10 页的 pptx，包含结论与数据来源」），我再试一次。",
      ];
    case "MODEL_CALL_FAILED":
      // provider 的原话（`ModelCallError.detail`）到服务端日志为止——那条纪律写在
      // `ModelCallError` 自己的头注里：这个对象上没有任何一个字段是可以顺手交给客户端的。
      return [
        `⚠ 重新生成脚本时模型调用失败（${code}），本轮**没有**产出文件。`,
        "失败发生在向模型请求脚本这一步，不是沙箱执行；详细原因已记入服务端日志。",
      ];
    case "UNKNOWN_EXECUTION_ERROR":
      // 认不出的异常：照实说"执行器抛了这个"，不冒充成沙箱的输出。
      return [
        `⚠ 脚本执行失败（${code}），本轮**没有**产出文件。执行器抛出的异常：`,
        "",
        "```",
        stderr.trim() === "" ? "（无异常信息）" : stderr,
        "```",
      ];
    default:
      // 沙箱真的跑过的三种失败：**真实 stderr 原样出现**（#660 / #1611，T4 钉死）。
      return [
        `⚠ 脚本执行失败（${code}），本轮**没有**产出文件。沙箱返回的真实错误输出：`,
        "",
        "```",
        stderr.trim() === "" ? "（沙箱未返回 stderr）" : stderr,
        "```",
      ];
  }
}
