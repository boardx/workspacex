import { afterEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest: request }));
import { getPlatformAiCatalogEntry } from "@/lib/ai-catalog-admin";
const entry = {
  orgId: "org-b",
  kind: "skill" as const,
  entityType: "skill-contract" as const,
  id: "same-id",
  name: "Contract",
  description: "Description",
  versionId: null,
  scope: "organization" as const,
  published: false,
  enabled: true,
  avatarUrl: null,
};
const definition = {
  kind: "skill-contract",
  input: {
    name: "Contract",
    description: "Description",
    source: "自建",
    status: "草稿",
    versionId: null,
    modelRef: null,
    versionState: null,
    declaration: null,
  },
};
afterEach(() => vi.clearAllMocks());
it("disambiguates same-ID legacy definitions using the canonical query", async () => {
  request.mockResolvedValue({ entry, definition });
  await getPlatformAiCatalogEntry(entry);
  expect(request).toHaveBeenCalledWith(
    "/platform/organizations/org-b/ai-catalog/skill/same-id",
    { query: { entityType: "skill-contract" } },
  );
});
it("rejects a detail response belonging to a different organization", async () => {
  request.mockResolvedValue({
    entry: { ...entry, orgId: "org-c" },
    definition,
  });
  await expect(getPlatformAiCatalogEntry(entry)).rejects.toThrow(
    "catalog_detail_scope_mismatch",
  );
});
