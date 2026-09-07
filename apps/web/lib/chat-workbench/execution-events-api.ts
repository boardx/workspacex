import { parseExecutionEvent } from "@repo/contracts/execution-journal";
import { apiRequest } from "@/lib/api-client";
/** Shared cursor reader for initial replay and resumed run tails. */
export async function readExecutionPage(runId: string, afterSeq: number, bearer?: string, signal?: AbortSignal) {
  const result = await apiRequest<{ events: unknown[]; legacyEvents?: unknown[]; nextSeq: number | null }>(
    `/agent-runs/${encodeURIComponent(runId)}/execution-events?afterSeq=${afterSeq}`,
    { sessionToken: bearer, signal },
  );
  return { events: [...(result.legacyEvents ?? []), ...result.events].map(parseExecutionEvent).filter((event) => event !== null), nextSeq: result.nextSeq };
}
