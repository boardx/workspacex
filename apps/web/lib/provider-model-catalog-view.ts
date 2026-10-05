import type { ProviderModelCatalogEntry, ProviderModelCapability } from "@repo/contracts/provider-model-catalog";

export const CATALOG_CAPABILITY_LABELS: Record<ProviderModelCapability, string> = {
  "text-generation": "文字生成", "vision-understanding": "视觉理解",
  "image-generation": "图片生成", "image-editing": "图片编辑", "video-generation": "视频生成",
  "speech-synthesis": "语音合成", "speech-recognition": "语音识别", "speech-to-speech": "语音对话",
  embedding: "向量", rerank: "重排序", "music-generation": "音乐生成",
  "world-model": "世界模型", "3d-generation": "3D 生成", decision: "决策",
};
export const CATALOG_MODALITY_LABELS = {
  text: "文本", image: "图片", audio: "音频", video: "视频", vector: "向量", "3d": "3D", structured: "结构化结果",
} as const;

export function filterProviderModels(
  models: readonly ProviderModelCatalogEntry[],
  query: string,
  capability: string,
  vendor: string,
): readonly ProviderModelCatalogEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return models.filter((model) =>
    (capability === "all" || model.capabilities.includes(capability as ProviderModelCapability)) &&
    (vendor === "all" || model.originalVendor === vendor) &&
    (!needle || [model.modelId, model.displayName, model.originalVendor ?? "", "阿里云 百炼 Alibaba Bailian",
      ...model.capabilities.map((value) => CATALOG_CAPABILITY_LABELS[value]),
    ].join(" ").toLocaleLowerCase().includes(needle)),
  ).sort((a, b) => (a.modelId === "qwen3.8-max" ? -1 : b.modelId === "qwen3.8-max" ? 1 : a.modelId.localeCompare(b.modelId)));
}
