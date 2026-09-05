import { describe, expect, it, vi } from "vitest";
import { TavilyGuidedSearch } from "../../src/infrastructure/research/tavily-guided-search";

describe("guided research search adapter", () => {
  it("sends the query to the configured provider and preserves returned evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [
      { title: "Policy", url: "https://example.org/policy", content: "Summary", raw_content: "Retrieved policy text" },
    ] }), { status: 200 }));
    const adapter = new TavilyGuidedSearch("test-only-key", fetcher, "https://example.org/search");
    expect(await adapter.search("grid policy")).toEqual([{ title: "Policy", url: "https://example.org/policy", content: "Retrieved policy text" }]);
    expect(fetcher).toHaveBeenCalledWith("https://example.org/search", expect.objectContaining({
      method: "POST", redirect: "error", headers: { Authorization: "Bearer test-only-key", "Content-Type": "application/json" },
      body: JSON.stringify({ query: "grid policy", search_depth: "advanced", max_results: 5, include_raw_content: true }),
    }));
  });
  it("does not call a provider without credentials", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new TavilyGuidedSearch("", fetcher).search("policy")).rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["javascript:alert(1)", "https://user:password@example.org/policy"])("rejects an unsafe source URL: %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: "Policy", url, content: "Text" }] })));
    await expect(new TavilyGuidedSearch("test-only-key", fetcher).search("policy")).rejects.toMatchObject({ reasonCode: "RESEARCH_CONTENT_REFERENCE_INVALID" });
  });
  it("surfaces provider failures without exposing response bodies or inventing hits", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive provider diagnostic", { status: 503 }));
    await expect(new TavilyGuidedSearch("test-only-key", fetcher).search("policy")).rejects.toMatchObject({ message: "RESEARCH_SEARCH_UNAVAILABLE" });
  });
  it("rejects hits without retrieved content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: "Policy", url: "https://example.org/policy", content: " " }] })));
    await expect(new TavilyGuidedSearch("test-only-key", fetcher).search("policy")).rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_CONTENT_EMPTY" });
  });
});
