import { z } from "zod";
import { ResearchRuntimeError, type GuidedSearchPort } from "../../application/research/guided-runtime-ports";
const Response = z.object({ results: z.array(z.object({
  title: z.string().min(1), url: z.string().url(), content: z.string(), raw_content: z.string().nullable().optional(),
})) });
export class TavilyGuidedSearch implements GuidedSearchPort {
  constructor(private readonly key = process.env.TAVILY_API_KEY ?? "", private readonly fetcher: typeof fetch = fetch, private readonly endpoint = process.env.KERNEL_GUIDED_SEARCH_URL ?? "https://api.tavily.com/search") {}
  async search(query: string) {
    if (!this.key) throw new ResearchRuntimeError("RESEARCH_SEARCH_NOT_CONFIGURED");
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, search_depth: "advanced", max_results: 5, include_raw_content: true }),
        signal: AbortSignal.timeout(45000), redirect: "error",
      });
      if (!response.ok) throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
      return Response.parse(await response.json()).results.map((result) => {
        const url = new URL(result.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID");
        const content = (result.raw_content || result.content).trim().slice(0, 30000);
        if (!content) throw new ResearchRuntimeError("RESEARCH_SEARCH_CONTENT_EMPTY");
        return { title: result.title, url: url.href, content };
      });
    } catch (error) {
      if (error instanceof ResearchRuntimeError) throw error;
      throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
    }
  }
}
