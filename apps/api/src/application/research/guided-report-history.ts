import type { ResearchRuntime } from "./guided-runtime-ports";

/** Retain the last formal publication, or latest unpublished attempt when none
 * exists, for viewing only; never for checkpoint validation or completion. */
export function preservePreviousReport(state: ResearchRuntime) {
  // A failed regeneration has no publication. Its complete draft must not
  // replace the last durable formal report when another attempt starts.
  if (!state.report && state.reportPrevious?.report && !state.reportPrevious.partial) return;
  const chapters = state.reportCheckpoint?.chapters ?? [];
  const text = state.reportStream?.text ?? "";
  // An empty restarted attempt must not overwrite the last visible chapter draft.
  if (!state.report && !state.reportDraft && !chapters.length && !/"body"\s*:\s*"[^"\s]/.test(text)) return;
  state.reportPrevious = structuredClone({
    title: state.brief.topic,
    createdAt: new Date().toISOString(),
    report: state.report,
    draft: state.reportDraft ?? null,
    qualityWarnings: state.reportQualityWarnings ?? [],
    partial: Boolean(state.reportPartial),
    evidenceWarnings: state.reportEvidenceWarnings ?? [],
    text,
    chapters,
    // Historical rendering needs links and descriptions, not duplicate full excerpts.
    sources: state.sources.map((source) => ({ ...source, content: source.content.slice(0, 600) })),
    outline: state.outline,
    aliases: state.reportSourceAliases ?? [],
  });
}
