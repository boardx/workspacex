import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { aidtVirtualResearchBinding, suggestAidtSimulationExcerpt, verifyAidtVirtualResearch } from "@/features/aidt/lib/aidt-test-research";

it("binds a selected excerpt to the exact simulated transcript without modifying the native report", async () => {
  const documents = (["outline", "runs", "report"] as const).map(step => {
    const markdown = step === "runs" ? "模拟反馈：每斤成本还需要提示。" : "研究报告正文";
    return { step, documentId: step, version: 1, evidenceMode: "simulated", markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"), references: [] };
  });
  const source = {
    interviewId: "interview", revisionId: "revision", version: 1, documents,
    states: documents.map(document => ({ documentId: document.documentId, status: "completed" })),
  } as unknown as InterviewMarkdownEnvelope;
  const pin = aidtVirtualResearchBinding(source)!;
  expect((await verifyAidtVirtualResearch(source, pin))?.references).toEqual([]);

  const quote = "每斤成本还需要提示。";
  const start = documents[1]!.markdown.indexOf(quote);
  const end = start + quote.length;
  const finding = { anchor: `aidt-selected-${start}-${end}`, category: "function" as const, quote, start, end };
  expect((await verifyAidtVirtualResearch(source, { ...pin, findings: [finding] }))?.references)
    .toEqual([{ anchor: finding.anchor, quote, start, end }]);
  expect(await verifyAidtVirtualResearch(source, { ...pin, findings: [{ ...finding, quote: "伪造摘录" }] })).toBeNull();
  expect(documents[2]!.references).toEqual([]);
});

it("suggests an actual transcript excerpt for a paraphrased report", () => {
  const quote = "遇到一起购买的农资时，我很难把必须花和可以省的投入分开记录。";
  const transcript = `## 模拟对话\n\n${quote}`;
  const report = "建议支持合并记录一起购买的农资，避免要求用户把必须花和可以省的投入强行分开。";
  const suggested = suggestAidtSimulationExcerpt(transcript, report);
  expect(suggested).toMatchObject({ quote, exact: false });
  expect(transcript.slice(suggested?.start, suggested?.end)).toBe(quote);
  expect(suggestAidtSimulationExcerpt(transcript, "无关的报告")).toBeNull();
});
