import { expect, it } from "vitest";
import { appendOutlineGroup, moveOutlineGroup } from "@/lib/interview-outline-order";
import { interviewMarkdown } from "@repo/contracts";
const document = { documentId: "outline", step: "outline" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "" };
it.each(["\n", "\r\n"])("retains two expert groups when swapping an unterminated final subtree (%j)", (newline) => {
  const first = `## [甲](#expert-a)${newline}${newline}1. 甲问题？${newline}${newline}`;
  const second = `## [乙](#expert-b)${newline}${newline}1. 乙问题？`;
  const doc = { ...document, markdown: first + second };
  const blocks = interviewMarkdown.parseInterviewMarkdown(doc).blocks;
  for (const [headingId, direction] of [[blocks[0]!.headingId, 1], [blocks[1]!.headingId, -1]] as const) {
    const moved = moveOutlineGroup(doc, headingId, direction)!;
    const projection = interviewMarkdown.parseInterviewMarkdown({ ...doc, markdown: moved });
    expect(projection.blocks.map(block => block.links[0]?.url)).toEqual(["#expert-b", "#expert-a"]);
    expect(moved.slice(projection.blocks[0]!.contentStart, projection.blocks[0]!.end).trim()).toBe("1. 乙问题？");
    expect(moved.slice(projection.blocks[1]!.contentStart, projection.blocks[1]!.end).trim()).toBe("1. 甲问题？");
  }
});
it("appending retains every original byte including trailing whitespace and CRLF", () => {
  const raw = "# 提纲\r\n\r\n原文  \r\n\r\n";
  expect(appendOutlineGroup(raw, "q-new")).toBe(raw + "\r\n\r\n## [新增问题](#question-q-new)\r\n\r\n请填写开放式问题、目的与反例追问。\r\n");
});
it("moves sibling subtrees without crossing expert boundaries", () => {
  const prefix = "# 提纲\r\n\r\n## [甲](#expert-a)\r\n\r\n";
  const first = "### [背景](#question-a)\r\n\r\n原文  \r\n\r\n#### 深入追问\r\n\r\n追问\r\n\r\n";
  const second = "### [反例](#question-b)\r\n\r\n保留 **原文**。\r\n\r\n";
  const suffix = "## [乙](#expert-b)\r\n\r\n### [乙问题](#question-c)\r\n\r\n不移动\r\n";
  const doc = { ...document, markdown: prefix + first + second + suffix };
  expect(moveOutlineGroup(doc, "section-3", 1)).toBe(prefix + second + first + suffix);
  expect(moveOutlineGroup(doc, "section-5", 1)).toBeNull();
});
