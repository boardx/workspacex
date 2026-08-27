/**
 * `generateThreadTitle` —— 线程自动命名叠加模型摘要。
 *
 * ## 为什么现在才加：`thread-title.ts` 头注早就留了缝
 *
 * `deriveThreadTitle`（domain 层纯函数，`domain/chat/thread-title.ts`）文件头注早就
 * 写明：将来若要叠模型，只需在调用点先试模型、失败落回该函数，不必再写第二份截断
 * 规则。本文件就是"先试模型"那一半；`deriveThreadTitle` 一行没改，仍是失败时唯一的
 * 落地点（经由该文件同样导出的 `clampModelGeneratedTitle` 共用同一套折叠/码点截断
 * 纪律）。
 *
 * ## 人类已知悉并接受的代价（2026-08-27 裁决：接受代价，配合乐观占位符缓解②）
 *
 * `thread-title.ts` 头注列的三条"不用模型"的理由，本次裁决逐条对应的缓解措施：
 *   ① 降级路径仍然是 `deriveThreadTitle` 的截断——本文件任何失败都不抛，只返回
 *      `null`，调用点据此落回域函数，绝不让"标题起不好"变成一次失败的发消息请求。
 *   ② "标题会自己变"：`acceptHumanMessage` 是同步调用链（见调用点
 *      `message-roundtrip.ts` 的 `autoTitleFromFirstMessage`），标题在这次请求返回
 *      之前就已经落地是模型版本还是截断版本——用户发送后看到的第一版标题就是最终
 *      版本，不存在"先显示新对话、几秒后自己跳成别的名字"的二次跳变，代价只是这次
 *      请求多花至多 `THREAD_TITLE_TIMEOUT_MS` 的时间（远小于模型真实推理一轮对话
 *      的时长，用户已经在等那个）。
 *   ③ 模型输出不确定——验收/测试只能断言"标题非空且不等于新对话"（弱断言），逐字
 *      稳定性验证仍然只钉 `deriveThreadTitle` 那条纯函数路径不变。
 *
 * ## 固定走 deps.titleModel，不是被选中 Agent 的快照
 *
 * 同 `generate-followup-suggestions.ts` 的既有先例（该文件头注「用哪个 provider
 * 调用」一节）：这是"读首条消息起个名"的轻量元任务，不需要被选中 Agent 的推理/工具
 * 能力，固定走这个部署配置的标准单次补全 provider（`readThreadTitleModelConfig`，
 * `infrastructure/chat/thread-title-model-config.ts` 的唯一事实源），且**不传
 * `threadId`**——避免 `DeepAgentModelProvider` 把这次调用误当成要接续的真实会话
 * （DA-04 确定性 thread 派生 + 幂等复用），把假的 system/user turn 写进真实会话的
 * 持久化历史。
 *
 * ## 硬超时：应用层自己包一层 `Promise.race`
 *
 * `ModelCallPort.complete` 不接受 `AbortSignal`，`ConfiguredModelProvider` 自己的
 * 超时（`KERNEL_MODEL_TIMEOUT_MS`，默认 180s）对"侧栏第一眼就要出现的标题"太长——
 * 本函数用 `Promise.race` 包一层短得多的超时（`THREAD_TITLE_TIMEOUT_MS`），超时或
 * 任何异常一律 catch 成 `null`，不抛。这是本 feature 唯一原创的技术点：
 * `application`/`domain` 层此前没有任何 `Promise.race`/`withTimeout` 助手。
 */
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import { clampModelGeneratedTitle } from "../../domain/chat/thread-title";

/**
 * 自动命名固定使用的 provider/modelId——不是被选中 Agent 的快照。唯一实现是
 * `readThreadTitleModelConfig`（`infrastructure/chat/thread-title-model-config.ts`），
 * 这里只声明接口形状（洋葱架构：应用层不反向 import 基础设施层），由调用方
 * （controller）在组装 `GenerateThreadTitleDeps` 时注入。
 */
export interface ThreadTitleModelConfig {
  readonly provider: string;
  readonly modelId: string;
}

/** DI token for `ThreadTitleModelConfig`——组合根（`kernel.module.ts`）绑定到
 * `readThreadTitleModelConfig()` 的结果；controller 按这个 token 注入，不直接 import
 * infra reader（interface 层不得直接 import infrastructure，见 `lint-arch-deps.mjs`
 * 的洋葱架构门控）。 */
export const THREAD_TITLE_MODEL_CONFIG = Symbol("ThreadTitleModelConfig");

export interface GenerateThreadTitleDeps {
  readonly model: ModelCallPort;
  readonly titleModel: ThreadTitleModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

/** 硬超时。轻量元任务，不该让"起名字"这一件装饰性的事拖慢发消息这个用户能直接
 *  感知的动作——见本文件头注「硬超时」一节。 */
export const THREAD_TITLE_TIMEOUT_MS = 3_000;

/**
 * 导出只为潜在的 loopback 取证分支预留（同 `FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT` 的
 * 既有先例）——真产品行为不依赖这一点，纯粹是让"这次调用带着真实首条消息正文"这件事
 * 可以被脚本级取证逐字匹配。
 */
export const THREAD_TITLE_SYSTEM_PROMPT =
  "你是一个对话系统的标题生成器。根据用户的第一条消息，生成一个简短的对话标题，" +
  "6 到 12 个汉字以内（或等效长度的其它语言字符），概括这条消息的主题或意图。" +
  "只输出标题本身这一行文字，不要加引号、句号、markdown 标记或任何解释性文字。";

/**
 * @returns 模型生成并经过折叠/截断处理的标题；模型不可用、超时、或回复为空一律
 *          返回 `null`（调用点据此落回 `deriveThreadTitle(首条消息原文)`）。
 */
export async function generateThreadTitle(
  deps: GenerateThreadTitleDeps,
  input: { readonly firstMessageText: string },
): Promise<string | null> {
  let completion: { readonly text: string };
  try {
    completion = await Promise.race([
      deps.model.complete({
        modelProvider: deps.titleModel.provider,
        modelId: deps.titleModel.modelId,
        // ⚠ 不传 threadId：同 generate-followup-suggestions.ts 的既有先例，避免
        // DeepAgentModelProvider 把这次「起标题」的调用误当成要接续的真实会话。
        system: THREAD_TITLE_SYSTEM_PROMPT,
        user: input.firstMessageText,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("thread title model call timed out")), THREAD_TITLE_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    const detail = e instanceof ModelCallError
      ? e.detail
      : e instanceof Error ? e.message : "unexpected model call failure";
    deps.log("thread title model call failed", {
      modelProvider: deps.titleModel.provider,
      modelId: deps.titleModel.modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail,
    });
    return null;
  }

  return clampModelGeneratedTitle(completion.text);
}
