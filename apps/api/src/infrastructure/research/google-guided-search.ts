import { research as C } from "@repo/contracts";
import { ResearchRuntimeError, type GuidedSearchPort } from "../../application/research/guided-runtime-ports";

/** BoardX's existing Google Custom Search proxy returns excerpts, not full-page content. */
export class GoogleGuidedSearch implements GuidedSearchPort {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = process.env.KERNEL_GUIDED_SEARCH_URL ?? "https://www.web-search.boardx.us/",
  ) {}

  async search(query: string) {
    if (!this.endpoint.trim()) throw new ResearchRuntimeError("RESEARCH_SEARCH_NOT_CONFIGURED");
    try {
      const url = new URL(this.endpoint);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw new ResearchRuntimeError("RESEARCH_SEARCH_NOT_CONFIGURED");
      }
      url.searchParams.set("q", query);
      const response = await this.fetcher(url.href, {
        method: "GET", headers: { Accept: "application/json", "User-Agent": "boardx-research-agent" },
        signal: AbortSignal.timeout(45000), redirect: "error",
      });
      if (!response.ok) throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
      const hits = C.GuidedResearchSearchProviderResponse.parse(await response.json()).results;
      return hits.slice(0, 5).map((hit) => {
        const sourceUrl = new URL(hit.url);
        if (!["http:", "https:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) {
          throw new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID");
        }
        const content = hit.snippet.trim().slice(0, 30000);
        if (!content) throw new ResearchRuntimeError("RESEARCH_SEARCH_CONTENT_EMPTY");
        return { title: hit.title, url: sourceUrl.href, content };
      });
    } catch (error) {
      if (error instanceof ResearchRuntimeError) throw error;
      throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
    }
  }

  async read(url: string) {
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("blocked");
      const response = await this.fetcher(parsed.href, { headers: { Accept: "text/html,text/plain,application/pdf" }, signal: AbortSignal.timeout(10000), redirect: "error" });
      if (!response.ok) throw new Error("unavailable");
      const type = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
      if (!["text/html", "text/plain", "text/markdown", "application/pdf"].includes(type)) throw new Error("unsupported");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 1_048_576) throw new Error("too_large");
      const text = type === "application/pdf" ? new TextDecoder().decode(bytes).replace(/[^\x20-\x7e\n\u4e00-\u9fff]/g, " ") : new TextDecoder().decode(bytes).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
      const clean = text.replace(/\s+/g, " ").trim().slice(0, 60000);
      if (!clean) throw new Error("empty");
      return { text: clean, contentKind: type === "application/pdf" ? "pdf" as const : type === "text/plain" || type === "text/markdown" ? "text" as const : "html" as const, truncated: text.length > 60000 };
    } catch (error) {
      if (error instanceof ResearchRuntimeError) throw error;
      throw new ResearchRuntimeError(`RESEARCH_DOCUMENT_${error instanceof Error ? error.message.toUpperCase() : "UNAVAILABLE"}`);
    }
  }
}
