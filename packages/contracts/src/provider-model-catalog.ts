import { z } from "zod";

/** Public provider facts, never tenant configuration or permission to dispatch a model. */
const OfficialSource = z.object({
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "help.aliyun.com";
  }, "An official Alibaba Cloud documentation URL is required"),
  title: z.string().min(1).max(100),
  observedAt: z.string().datetime(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const ProviderModelCapability = z.enum([
  "text-generation", "vision-understanding", "image-generation", "image-editing",
  "video-generation", "speech-synthesis", "speech-recognition", "speech-to-speech",
  "embedding", "rerank", "music-generation", "world-model", "3d-generation", "decision",
]);
const Modality = z.enum(["text", "image", "audio", "video", "vector", "3d", "structured"]);

/** Scope matters: a limit quoted for image editing must not become a text-to-image limit. */
export const ProviderModelParameterFact = z.object({
  name: z.string().min(1).max(100),
  value: z.string().min(1).max(160),
  scope: z.string().min(1).max(100),
  sourceUrl: z.string().url(),
}).strict();

export const ProviderModelCatalogEntry = z.object({
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  platform: z.literal("aliyun-bailian"),
  originalVendor: z.string().min(1).max(100).nullable(),
  capabilities: z.array(ProviderModelCapability).min(1),
  inputModalities: z.array(Modality),
  outputModalities: z.array(Modality),
  modalityCoverage: z.enum(["unknown", "partial", "documented"]),
  /** Null is unknown, never a fabricated minimum context window. */
  contextWindow: z.number().int().positive().nullable(),
  regions: z.array(z.string().min(1).max(50)),
  regionCoverage: z.enum(["unknown", "documented"]),
  parameters: z.array(ProviderModelParameterFact),
  parameterCoverage: z.literal("published-summary"),
  billing: z.object({
    unit: z.enum(["token", "image", "character", "audio-second", "video-second", "request"]).nullable(),
    price: z.number().finite().nonnegative().nullable(),
    currency: z.enum(["CNY", "USD"]).nullable(),
    scope: z.string().min(1).max(160),
    sourceUrl: z.string().url().nullable(),
  }).strict(),
  availability: z.literal("unknown"),
  /** A public entry can never assert that an organization's adapter is admitted. */
  adapterStatus: z.literal("requires-configuration-and-verification"),
  sources: z.array(OfficialSource).min(1),
}).strict().superRefine((entry, ctx) => {
  const urls = new Set(entry.sources.map((source) => source.url));
  const knownDirections = Number(entry.inputModalities.length > 0) + Number(entry.outputModalities.length > 0);
  const expectedCoverage = knownDirections === 2 ? "documented" : knownDirections === 1 ? "partial" : "unknown";
  if (entry.modalityCoverage !== expectedCoverage) ctx.addIssue({ code: "custom", message: "Modality coverage contradicts recorded facts", path: ["modalityCoverage"] });
  for (const fact of entry.parameters) {
    if (!urls.has(fact.sourceUrl)) ctx.addIssue({ code: "custom", message: "Parameter source is missing", path: ["parameters"] });
  }
  if (entry.billing.sourceUrl !== null && !urls.has(entry.billing.sourceUrl)) {
    ctx.addIssue({ code: "custom", message: "Billing source is missing", path: ["billing"] });
  }
  if (entry.regionCoverage === "unknown" && entry.regions.length > 0) {
    ctx.addIssue({ code: "custom", message: "Unknown region coverage cannot claim regions", path: ["regions"] });
  }
  if (entry.billing.price !== null && (entry.billing.unit === null || entry.billing.currency === null || entry.billing.sourceUrl === null)) {
    ctx.addIssue({ code: "custom", message: "A price requires its unit, currency and official billing source", path: ["billing"] });
  }
});

export const ProviderModelCatalog = z.object({
  schemaVersion: z.literal(1),
  platform: z.literal("aliyun-bailian"),
  observedAt: z.string().datetime(),
  coverage: z.object({
    kind: z.literal("public-documentation-snapshot"),
    accountInventoryVerified: z.literal(false),
    allHistoricalVersionsVerified: z.literal(false),
    notes: z.array(z.string().min(1).max(300)).min(1),
    sources: z.array(OfficialSource).min(1),
  }).strict(),
  models: z.array(ProviderModelCatalogEntry).min(1),
}).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const [index, model] of catalog.models.entries()) {
    if (ids.has(model.modelId)) ctx.addIssue({ code: "custom", message: "Duplicate provider model ID", path: ["models", index, "modelId"] });
    ids.add(model.modelId);
  }
});
export type ProviderModelCatalogEntry = z.infer<typeof ProviderModelCatalogEntry>;
export type ProviderModelCapability = z.infer<typeof ProviderModelCapability>;
export type ProviderModelCatalog = z.infer<typeof ProviderModelCatalog>;
