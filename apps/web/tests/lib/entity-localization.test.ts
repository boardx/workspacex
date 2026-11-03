import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEntityDisplay } from "@repo/contracts/entity-localization";
import { apiRequest } from "@/lib/api-client";
import { getEntityLocalization, putEntityLocalization, localizedText } from "@/lib/entity-localization";
vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));
const source = { orgId: "org", entityId: "skill", kind: "skill", revision: "v1", locale: "zh-CN", fields: { name: "S061", summary: "源简介" } };
const view = { source, translation: null };
beforeEach(() => vi.mocked(apiRequest).mockReset());
describe("entity localization client and source-safe text", () => {
  it("uses the contract route, signal and response parser", async () => {
    vi.mocked(apiRequest).mockResolvedValue(view);
    const signal = new AbortController().signal;
    expect((await getEntityLocalization("skill", "a/b", "en", signal)).source.revision).toBe("v1");
    expect(apiRequest).toHaveBeenCalledWith("/admin/skills/a%2Fb/localizations/en", { method: "GET", signal });
  });
  it("sends normalized display-only fields and rejects executable extras locally", async () => {
    vi.mocked(apiRequest).mockResolvedValue(view);
    const input = { sourceRevision: "v1", expectedTranslationRevision: null, status: "reviewed" as const, fields: { name: " " } };
    await putEntityLocalization("agent", "agent", "en", input);
    expect(apiRequest).toHaveBeenCalledWith("/admin/agents/agent/localizations/en", { method: "PUT", body: { ...input, fields: { name: null } } });
    vi.mocked(apiRequest).mockClear();
    await expect(putEntityLocalization("agent", "agent", "en", { ...input, instructions: "overwrite" } as never)).rejects.toBeDefined();
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("preserves existing source formatting for source language and missing translations", () => {
    const sourceDisplay = resolveEntityDisplay(source, "zh-CN");
    const fallbackDisplay = resolveEntityDisplay(source, "en");
    expect(localizedText(sourceDisplay, "name", "产品探索")).toBe("产品探索");
    expect(localizedText(fallbackDisplay, "name", "产品探索")).toBe("产品探索");
    expect(localizedText(undefined, "duty", null)).toBeNull();
  });
  it("uses a translated field without mutating the source name or stable identifier", () => {
    const display = resolveEntityDisplay(source, "en", { orgId: "org", entityId: "skill", kind: "skill", sourceRevision: "v1", locale: "en", revision: 1, status: "reviewed", fields: { name: "Product discovery" } });
    expect(localizedText(display, "name", "产品探索")).toBe("Product discovery");
    expect(localizedText(display, "summary", "源简介")).toBe("源简介");
    expect(source.fields.name).toBe("S061");
  });
});
