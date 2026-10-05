import { describe, expect, it } from "vitest";
import { bailianModelCatalog } from "../src/bailian-model-catalog";
import { ProviderModelCatalog, ProviderModelCatalogEntry } from "../src/provider-model-catalog";

const original = bailianModelCatalog.models.find((model) => model.modelId === "qwen3.8-max")!;

describe("Bailian public model catalog trust boundary", () => {
  it("covers published modality families and third-party namespaces with real source references", () => {
    expect(bailianModelCatalog.models.length).toBeGreaterThan(250);
    const ids = new Set(bailianModelCatalog.models.map((model) => model.modelId));
    for (const id of ["qwen3.8-max", "deepseek-v4-pro", "ZHIPU/GLM-5.3", "MiniMax/speech-2.8-hd", "kimi/kimi-k3", "wan3.0-video", "qwen-audio-3.1-asr-flash-filetrans", "qwen3.7-text-embedding", "Tripo/Tripo-H3.1", "happyoyster-1.0-adventure"]) expect(ids.has(id)).toBe(true);
    expect(ids.has("GPT-5.5")).toBe(false);
    expect(ids.has("Claude Opus 4.7")).toBe(false);
    expect(original.contextWindow).toBe(1_000_000);
    expect(original.capabilities).toContain("vision-understanding");
    const tripo = bailianModelCatalog.models.find((model) => model.modelId === "Tripo/Tripo-H3.1")!;
    expect(tripo.inputModalities).toContain("image");
    expect(tripo.outputModalities).toContain("3d");
    expect(original.sources.every((source) => source.contentSha256.length === 64)).toBe(true);
  });
  it("never treats a public snapshot as account inventory or admitted tenant models", () => {
    expect(bailianModelCatalog.coverage.accountInventoryVerified).toBe(false);
    expect(bailianModelCatalog.coverage.allHistoricalVersionsVerified).toBe(false);
    for (const model of bailianModelCatalog.models) {
      expect(model.availability).toBe("unknown");
      expect(model.adapterStatus).toBe("requires-configuration-and-verification");
      expect(model.billing.price).toBeNull();
    }
    expect(ProviderModelCatalogEntry.safeParse({ ...original, availability: "available" }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, adapterStatus: "enabled" }).success).toBe(false);
  });
  it("rejects secret fields, duplicate model IDs and unsupported schema versions", () => {
    expect(ProviderModelCatalogEntry.safeParse({ ...original, apiKey: "private" }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, endpoint: "https://internal" }).success).toBe(false);
    expect(ProviderModelCatalog.safeParse({ ...bailianModelCatalog, models: [original, original] }).success).toBe(false);
    expect(ProviderModelCatalog.safeParse({ ...bailianModelCatalog, schemaVersion: 2 }).success).toBe(false);
  });
  it("requires official provenance for each parameter fact and billing fact", () => {
    expect(ProviderModelCatalogEntry.safeParse({ ...original, parameters: [{ name: "context", value: "10", scope: "unknown", sourceUrl: "https://example.com/fake" }] }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, sources: [{ ...original.sources[0], url: "https://help.aliyun.com.evil.test/fake" }] }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, billing: { ...original.billing, sourceUrl: "https://example.com/fake" } }).success).toBe(false);
  });
  it("refuses fabricated minimum context, unscoped price and claimed unknown regions", () => {
    expect(ProviderModelCatalogEntry.safeParse({ ...original, contextWindow: 0 }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, billing: { ...original.billing, price: 0.01 } }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, billing: { ...original.billing, price: 0.01, unit: "token", currency: "CNY", sourceUrl: null } }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, regions: ["cn-beijing"], regionCoverage: "unknown" }).success).toBe(false);
    expect(ProviderModelCatalogEntry.safeParse({ ...original, contextWindow: null }).success).toBe(true);
  });
});
