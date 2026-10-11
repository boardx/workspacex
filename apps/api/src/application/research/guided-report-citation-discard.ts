import { research as C } from "@repo/contracts";

/** Generated references are optional presentation, never evidence. Keep only
 * exact supplied identities in the current scope, without guessing replacements.
 * Shared citation parsing preserves code and ordinary numeric footnotes. */
export function discardInvalidReportCitations(text: string, allowed: ReadonlySet<string>, resolve: (id: string) => string): string {
  let current = text;
  for (;;) {
    const next = C.mapGuidedResearchCitations(current, id => {
      let canonical: string;
      try { canonical = resolve(id); } catch { return ""; }
      return allowed.has(canonical) ? `[[source:${canonical}]]` : "";
    }, fragment => {
      // The shared parser returns the rest of the line for an incomplete marker.
      // Remove just its first token; the next pass handles later valid markers.
      return fragment.replace(/^\[{2,}(?:source:)?[a-z0-9_.:/-]*\]*(?:\[(?!\[)(?:source:[a-z0-9_.:/-]+|S\d+|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\]+)*/i, "");
    });
    if (next === current) return next.trim();
    current = next;
  }
}
