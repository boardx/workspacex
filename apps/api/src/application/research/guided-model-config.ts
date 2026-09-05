export function guidedModelConfig() {
  return {
    provider: process.env.KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER ?? process.env.KERNEL_MODEL_PROVIDER ?? "",
    id: process.env.KERNEL_GUIDED_RESEARCH_MODEL_ID ?? process.env.KERNEL_MODEL_ID ?? "qwen3.7-plus",
  };
}
