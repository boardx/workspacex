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
}
