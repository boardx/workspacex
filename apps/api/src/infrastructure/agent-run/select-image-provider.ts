/**
 * `wx_image_generate` 用哪一家供应商——**判定只写在这里一处**，`kernel.module.ts` 只
 * 负责把结果接上去（本仓五次因「同一事实两处声明」漂移，见 AGENTS.md 硬约束）。
 *
 * ## 三条规则，按顺序
 *
 * 1. `KERNEL_IMAGE_PROVIDER` 显式指定（`openai` / `bailian`）⇒ 就用它。这一家没配
 *    key ⇒ 返回 `null`（图像工具整体不注册），**不偷偷回落到另一家**：人明确点名了
 *    一家却跑了另一家，是比「功能没上」更难查的故障。
 * 2. 没指定 ⇒ 百炼有 key 就用百炼。这是本次改动前的唯一行为，保持逐字不变。
 * 3. 百炼没 key、OpenAI 有 key ⇒ 用 OpenAI。只配了 OpenAI 却因为忘了写开关而
 *    「图像功能静默消失」，是这条规则要挡掉的形态。
 *
 * 两家都没 key ⇒ `null`，与改动前一致（`STANDARD_IMAGE_SERVICE` 提供 `null`，
 * `wx_image_generate` 不出现在可调用工具里）。
 */
import { BailianImageProvider, readBailianImageProviderConfig } from "./bailian-image-provider";
import { OpenAiImageProvider, readOpenAiImageProviderConfig } from "./openai-image-provider";
import type { ImageGenerator } from "../../application/agent-run/standard-image-tools";

export type ImageProviderChoice = "openai" | "bailian";

export interface SelectedImageProvider {
  readonly choice: ImageProviderChoice;
  readonly provider: ImageGenerator;
}

export function selectImageProvider(env: NodeJS.ProcessEnv = process.env): SelectedImageProvider | null {
  const bailian = readBailianImageProviderConfig(env);
  const openai = readOpenAiImageProviderConfig(env);
  const bailianReady = bailian.apiKey.trim() !== "";
  const openaiReady = openai.apiKey.trim() !== "";
  const requested = (env.KERNEL_IMAGE_PROVIDER ?? "").trim().toLowerCase();

  const makeOpenAi = (): SelectedImageProvider => ({ choice: "openai", provider: new OpenAiImageProvider(openai) });
  const makeBailian = (): SelectedImageProvider => {
    const p = new BailianImageProvider(bailian);
    // `BailianImageProvider` 同时是 `ModelCallPort`（图片生成 agent 走那条），这里只
    // 取它的 `generateImage`，`modelRef` 用配置里的模型名——与改动前 `kernel.module.ts`
    // 里那行逐字相同的形状，不是新写的绑定方式。
    return { choice: "bailian", provider: { modelRef: bailian.modelId, generateImage: p.generateImage.bind(p) } };
  };

  if (requested === "openai") return openaiReady ? makeOpenAi() : null;
  if (requested === "bailian") return bailianReady ? makeBailian() : null;
  if (bailianReady) return makeBailian();
  if (openaiReady) return makeOpenAi();
  return null;
}
