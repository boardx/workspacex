import { expect, it } from "vitest";
import { appendOutlineGroup, moveOutlineGroup } from "@/lib/interview-outline-order";
const document = { documentId: "outline", step: "outline" as const, version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated" as const, references: [], markdown: "" };
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
