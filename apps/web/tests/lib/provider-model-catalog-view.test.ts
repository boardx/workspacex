import { describe, expect, it } from "vitest";
import { bailianModelCatalog } from "@repo/contracts/bailian-model-catalog";
import { filterProviderModels } from "@/lib/provider-model-catalog-view";

describe("public catalog search and capability selection", () => {
  it("searches real IDs and original vendors case-insensitively, without inference or credentials", () => {
    const models = filterProviderModels(bailianModelCatalog.models, " DEEPSEEK ", "all", "all");
    expect(models.length).toBeGreaterThan(10);
    expect(models.every((model) => model.originalVendor === "DeepSeek")).toBe(true);
  });
  it("combines modality and vendor filters, keeping namespace IDs intact", () => {
    const models = filterProviderModels(bailianModelCatalog.models, "", "speech-synthesis", "MiniMax");
    expect(models.map((model) => model.modelId)).toContain("MiniMax/speech-2.8-hd");
    expect(models.every((model) => model.capabilities.includes("speech-synthesis"))).toBe(true);
    expect(filterProviderModels(bailianModelCatalog.models, "", "image-generation", "DeepSeek")).toHaveLength(0);
  });
  it("prioritizes the currently used Qwen model and finds Chinese capability labels", () => {
    expect(filterProviderModels(bailianModelCatalog.models, "", "all", "all")[0]?.modelId).toBe("qwen3.8-max");
    expect(filterProviderModels(bailianModelCatalog.models, "语音识别", "all", "all").length).toBeGreaterThan(20);
  });
});
