/**
 * 画布模板的两个模型辅助能力（章节建议 / 提示词试跑）用哪个模型 —— **唯一事实源**。
 *
 * 与 `research/guided-model-config.ts` 同一条纪律，同一个理由：此前 provider 的解析链在
 * `suggest-template-sections.ts` 与 `simulate-template-run.ts` 里各写了一遍，而模型 id
 * 在两处都是写死的 `"qwen3.7-plus"`——只能跟着 DashScope 的模型池走。
 *
 * 写死的代价不是不雅，是**在两种真实部署里必然失败**：
 *   · WorkspaceX Local 只有 Ollama 上的 `qwen3.5:4b`，`qwen3.7-plus` 不存在 ⇒ 必 404；
 *   · personal-local 组织承诺只走本机/自托管端点，云端模型在那里不可选（F16）。
 *
 * ⚠ 终端回退值仍是 `qwen3.7-plus`：什么都没配的部署，行为与改动前逐字一致。
 */
export interface CanvasTemplateModelConfig {
  readonly provider: string;
  readonly id: string;
}

export function canvasTemplateModelConfig(providerOverride?: string): CanvasTemplateModelConfig {
  return {
    provider: providerOverride
      ?? process.env.KERNEL_CANVAS_TEMPLATE_MODEL_PROVIDER
      ?? process.env.KERNEL_MODEL_PROVIDER
      ?? "",
    id: process.env.KERNEL_CANVAS_TEMPLATE_MODEL_ID
      ?? process.env.KERNEL_MODEL_ID
      ?? "qwen3.7-plus",
  };
}
