import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import { ResearchRuntimeError, type GuidedSearchPort, type ResearchRuntime } from "./guided-runtime-ports";
import { boundedWork } from "./guided-bounded-work";

/** An extractive summary keeps every statement traceable to the fetched document. */
function summarizeBody(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  return paragraphs.slice(0, 3).join("\n\n").slice(0, 2000).trim();
}

export async function collectSourceDocuments(sources: ResearchRuntime["sources"], read: NonNullable<GuidedSearchPort["read"]>, persist: () => Promise<void>, options: { retryTransient?: boolean; signal?: AbortSignal } = {}) {
  const pending = sources.filter((source) => source.decision === "accepted" && !source.document
    && (!source.documentError || (options.retryTransient && source.documentError === "unavailable")));
  await boundedWork(pending, 3, (source) => read(source.url), async (source, result) => {
      options.signal?.throwIfAborted();
      try {
        if (result.status === "rejected") throw result.reason;
        source.document = C.GuidedResearchDocument.parse({
          url: source.url, retrievedAt: new Date().toISOString(), text: result.value.text,
          contentKind: result.value.contentKind, truncated: result.value.truncated,
          contentHash: createHash("sha256").update(result.value.text).digest("hex"),
          summary: summarizeBody(result.value.text),
        });
        delete source.documentError;
      } catch (error) {
        const reason = error instanceof ResearchRuntimeError ? error.reasonCode : "RESEARCH_DOCUMENT_UNAVAILABLE";
        source.documentError = reason.includes("BLOCKED") ? "blocked" : reason.includes("UNSUPPORTED") ? "unsupported" : reason.includes("EMPTY") ? "empty" : reason.includes("TOO_LARGE") ? "too_large" : "unavailable";
      }
      await persist();
  }, async () => { options.signal?.throwIfAborted(); });
}
