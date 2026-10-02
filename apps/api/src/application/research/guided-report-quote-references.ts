import { research as C } from "@repo/contracts";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { EvidenceChunk } from "./guided-report-evidence-validation";
const matchSchema = C.GuidedResearchEvidenceModelOutput.shape.evaluations.element.shape.matches.element;
const referenceMatchSchema = matchSchema.omit({ quote: true }).extend({ quoteRef: z.string().min(1) }).strict();
const quoteLimit = (zodToJsonSchema(matchSchema.shape.quote, { $refStrategy: "none" }) as { maxLength: number }).maxLength;
export function quoteOptions(chunk: EvidenceChunk) {
  const options: { quoteRef: string; text: string }[] = [];
  for (let start = 0; start < chunk.content.length;) {
    let end = Math.min(start + quoteLimit, chunk.content.length);
    // Prefer a natural boundary while keeping every non-whitespace character.
    if (end < chunk.content.length) {
      const window = chunk.content.slice(start, end);
      const boundary = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
      if (boundary > quoteLimit / 2) end = start + boundary + 1;
    }
    const text = chunk.content.slice(start, end).trim();
    if (text) options.push({ quoteRef: `${chunk.chunkId}#quote:${options.length}`, text });
    start = end;
  }
  return options;
}
export function materializeQuoteReferences(value: Record<string, unknown>, chunk: EvidenceChunk) {
  if (!Array.isArray(value.matches)) return value;
  const options = new Map(quoteOptions(chunk).map((option) => [option.quoteRef, option.text]));
  return { ...value, matches: value.matches.map((match) => {
    const parsed = referenceMatchSchema.safeParse(match);
    if (!parsed.success) return match;
    const quote = options.get(parsed.data.quoteRef);
    if (!quote) return match; // Unknown or foreign references fail the authoritative strict schema.
    const { quoteRef: _reference, ...rest } = parsed.data;
    return { ...rest, quote };
  }) };
}
export function evidenceWireChunk<T extends EvidenceChunk>(chunk: T) {
  const { content: _content, ...identity } = chunk;
  return { ...identity, quoteOptions: quoteOptions(chunk) };
}
