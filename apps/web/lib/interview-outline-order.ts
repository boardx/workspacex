import { interviewMarkdown } from "@repo/contracts";
import type { InterviewMarkdownDocument } from "./interview-markdown-api";

export function appendOutlineGroup(markdown: string, id: string): string {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  return markdown + `${newline}${newline}## [新增问题](#question-${id})${newline}${newline}请填写开放式问题、目的与反例追问。${newline}`;
}

/** Swap whole AST subtrees, keeping research text and references untouched. */
export function moveOutlineGroup(document: InterviewMarkdownDocument, headingId: string, direction: -1 | 1): string | null {
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  const index = blocks.findIndex((block) => block.headingId === headingId);
  const block = blocks[index];
  if (!block) return null;
  const parentOf = (at: number) => {
    for (let previous = at - 1; previous >= 0; previous--) {
      if (blocks[previous]!.depth < blocks[at]!.depth) return previous;
    }
    return -1;
  };
  const parent = parentOf(index);
  const siblings = blocks.filter((candidate, at) => candidate.depth === block.depth && parentOf(at) === parent);
  const siblingIndex = siblings.findIndex((candidate) => candidate.headingId === headingId);
  const neighbor = siblings[siblingIndex + direction];
  if (!neighbor) return null;
  const first = direction === 1 ? block : neighbor;
  const second = direction === 1 ? neighbor : block;
  // Only adjacent sibling subtrees may be swapped; never consume another owner.
  if (first.end !== second.start) return null;
  const raw = document.markdown;
  const movedFirst = raw.slice(second.start, second.end);
  // A final subtree need not end with a newline. Once moved before another
  // heading it must still terminate its last question on a separate line.
  const separator = movedFirst.endsWith("\n") ? "" : raw.includes("\r\n") ? "\r\n" : "\n";
  return raw.slice(0, first.start) + movedFirst + separator + raw.slice(first.start, first.end) + raw.slice(second.end);
}
