import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import type { ResearchRuntime } from "./guided-runtime-ports";
import { ResearchRuntimeError } from "./guided-runtime-ports";
import { canonicalEvidenceSources } from "./guided-report-evidence";
export function reportBasis(state: ResearchRuntime, config: { provider: string; id: string }, instruction?: string): string {
  const value = { protocol: "formal-report-v2", sessionId: state.sessionId, brief: state.brief, directions: state.directions, outline: state.outline,
    sources: state.sources.filter((source) => source.decision === "accepted").map(({ id, url, title, content, taskId }) => ({ id, url, title, content, taskId })).sort((a, b) => a.id.localeCompare(b.id)),
    tasks: [...state.tasks].sort((a, b) => a.id.localeCompare(b.id)), partial: Boolean(state.reportPartial), instruction: instruction ?? null, model: config };
  return createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
}
export function reportSourceAliases(state: ResearchRuntime) {
  const sources = canonicalEvidenceSources(state).sort((a, b) => a.url.localeCompare(b.url) || a.id.localeCompare(b.id));
  const ids = new Set(sources.map((source) => source.id)); let number = 1;
  return sources.map((source) => {
    let alias: string;
    do { alias = `S${number++}`; } while (ids.has(alias) && alias !== source.id);
    return { alias, sourceId: source.id };
  });
}
export function aliasResolver(aliases: ReturnType<typeof reportSourceAliases>) {
  const known = new Set(aliases.map((item) => item.sourceId));
  const mapping = new Map(aliases.map((item) => [item.alias, item.sourceId]));
  return (id: string) => {
    if (known.has(id)) return id;
    const resolved = mapping.get(id);
    if (!resolved) throw new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID");
    return resolved;
  };
}
export function canonicalReportText(text: string, resolve: (id: string) => string): string {
  try { return C.mapGuidedResearchCitations(text, (id) => `[[source:${resolve(id)}]]`, () => { throw new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID"); }); }
  catch { throw new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID"); }
}
export function canonicalChapter(value: unknown, resolve: (id: string) => string) {
  const parsed = C.GuidedResearchReport.shape.sections.element.safeParse(value);
  if (!parsed.success) throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
  return { ...parsed.data, body: canonicalReportText(parsed.data.body, resolve), sourceIds: parsed.data.sourceIds.map(resolve) };
}
