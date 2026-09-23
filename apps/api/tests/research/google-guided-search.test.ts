import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleGuidedSearch } from "../../src/infrastructure/research/google-guided-search";

const hit = { title: "Policy", url: "https://example.org/policy", snippet: "Retrieved policy excerpt" };
function provider(body: unknown = { results: [hit] }) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
}
afterEach(() => vi.unstubAllEnvs());

describe("BoardX Google guided research search", () => {
  it("uses the existing Google proxy without a Tavily key and preserves its real excerpt", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("KERNEL_GUIDED_SEARCH_URL", undefined);
    const fetcher = provider();
    expect(await new GoogleGuidedSearch(fetcher).search("德国 储能 & grid?")).toEqual([
      { title: hit.title, url: hit.url, content: hit.snippet },
    ]);
    const [address, options] = fetcher.mock.calls[0]!;
    const url = new URL(String(address));
    expect(url.origin).toBe("https://www.web-search.boardx.us");
    expect(url.searchParams.get("q")).toBe("德国 储能 & grid?");
    expect(options).toMatchObject({ method: "GET", redirect: "error", headers: { Accept: "application/json" } });
    expect(options?.headers).not.toHaveProperty("Authorization");
    expect(options?.body).toBeUndefined();
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it("supports a trusted configured proxy or isolated loopback fixture", async () => {
    const fetcher = provider();
    await new GoogleGuidedSearch(fetcher, "http://127.0.0.1:9999/search?region=eu").search("policy");
    expect(fetcher.mock.calls[0]![0]).toBe("http://127.0.0.1:9999/search?region=eu&q=policy");
  });
  it.each(["", "file:///search", "https://user:password@example.org/search"])("rejects invalid endpoint %s before fetching", async (endpoint) => {
    const fetcher = provider();
    await expect(new GoogleGuidedSearch(fetcher, endpoint).search("policy")).rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["javascript:alert(1)", "https://user:password@example.org/policy"])("rejects unsafe source URL %s", async (url) => {
    await expect(new GoogleGuidedSearch(provider({ results: [{ ...hit, url }] })).search("policy"))
      .rejects.toMatchObject({ reasonCode: "RESEARCH_CONTENT_REFERENCE_INVALID" });
  });
  it.each([401, 403, 429, 503])("surfaces HTTP %s without leaking provider diagnostics", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private diagnostics", { status }));
    await expect(new GoogleGuidedSearch(fetcher).search("policy")).rejects.toMatchObject({ message: "RESEARCH_SEARCH_UNAVAILABLE" });
  });
  it("surfaces timeouts without inventing hits", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    await expect(new GoogleGuidedSearch(fetcher).search("policy")).rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_UNAVAILABLE" });
  });
  it.each([{}, { results: [{ ...hit, snippet: undefined }] }, { results: "invalid" }])("rejects malformed payload %j", async (body) => {
    await expect(new GoogleGuidedSearch(provider(body)).search("policy")).rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_UNAVAILABLE" });
  });
  it("returns empty search results for the runtime to persist as a failed task", async () => {
    expect(await new GoogleGuidedSearch(provider({ results: [] })).search("policy")).toEqual([]);
  });
  it("rejects missing evidence instead of using the title as content", async () => {
    await expect(new GoogleGuidedSearch(provider({ results: [{ ...hit, snippet: " " }] })).search("policy"))
      .rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_CONTENT_EMPTY" });
  });
  it("bounds source count and excerpt size", async () => {
    const hits = await new GoogleGuidedSearch(provider({ results: Array.from({ length: 10 }, () => ({ ...hit, snippet: "x".repeat(31000) })) })).search("policy");
    expect(hits).toHaveLength(5);
    expect(hits[0]?.content).toHaveLength(30000);
  });
  it("reads the linked document separately from the search excerpt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html><body>Full policy text</body></html>", { headers: { "content-type": "text/html" } }));
    await expect(new GoogleGuidedSearch(fetcher).read!(hit.url)).resolves.toMatchObject({ text: "Full policy text", contentKind: "html", truncated: false });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });
  it("blocks private and metadata destinations before fetching documents", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new GoogleGuidedSearch(fetcher).read!("http://169.254.169.254/latest/meta-data"))
      .rejects.toMatchObject({ reasonCode: "RESEARCH_DOCUMENT_BLOCKED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows the isolated loopback search fixture to read its own evidence document", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("Controlled local evidence", { headers: { "content-type": "text/plain" } }));
    await expect(new GoogleGuidedSearch(fetcher, "http://127.0.0.1:9999/search").read!("http://127.0.0.1:9999/research-evidence"))
      .resolves.toMatchObject({ text: "Controlled local evidence", contentKind: "text" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not extend loopback fixture trust to other local origins", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new GoogleGuidedSearch(fetcher, "http://127.0.0.1:9999/search").read!("http://127.0.0.1:10000/research-evidence"))
      .rejects.toMatchObject({ reasonCode: "RESEARCH_DOCUMENT_BLOCKED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops reading as soon as a document exceeds the byte limit", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(600_000));
        if (pulled > 3) controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { "content-type": "text/plain" } }));
    await expect(new GoogleGuidedSearch(fetcher).read!(hit.url)).rejects.toMatchObject({ reasonCode: "RESEARCH_DOCUMENT_TOO_LARGE" });
    expect(pulled).toBe(3);
  });
  it("extracts PDF text from compressed content streams", async () => {
    const body = deflateSync(Buffer.from("BT /F1 12 Tf (Authoritative PDF evidence) Tj ET", "latin1")).toString("latin1");
    const pdf = `%PDF-1.4\n1 0 obj << /Length ${body.length} /Filter /FlateDecode >> stream\n${body}\nendstream endobj\n%%EOF`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(Buffer.from(pdf, "latin1"), { headers: { "content-type": "application/pdf" } }));
    await expect(new GoogleGuidedSearch(fetcher).read!(hit.url)).resolves.toMatchObject({ text: "Authoritative PDF evidence", contentKind: "pdf" });
  });
  it("rejects PDFs whose text cannot be extracted", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(Buffer.from("%PDF-1.4 binary-only", "latin1"), { headers: { "content-type": "application/pdf" } }));
    await expect(new GoogleGuidedSearch(fetcher).read!(hit.url)).rejects.toMatchObject({ reasonCode: "RESEARCH_DOCUMENT_EMPTY" });
  });
});
