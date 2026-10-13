import { describe, expect, it } from "vitest";
import { questionParagraphStream } from "../../src/application/research/guided-question-paragraph-stream";
import { research as C } from "@repo/contracts";

describe("live question prose projection", () => {
  it("publishes live body strings without private bindings, even across every token boundary", async () => {
    const raw = JSON.stringify({ sectionId: "untrusted-id", paragraphs: [{ questionId: "private-question", body: 'First "quoted" 😀 prose', sourceIds: ["private-source"] }, { questionId: "private-next", body: "Next paragraph" }], review: "private-review" });
    let publicText = '{"sections":[';
    let sawLiveBody = false;
    const publish = questionParagraphStream("trusted-section", async delta => { publicText += delta; });
    for (let i = 0; i < raw.length; i++) {
      await publish(raw[i]!);
      if (i < raw.length - 1 && C.researchReportPreview(publicText).sections[0]?.body.includes("First")) sawLiveBody = true;
      expect(publicText).not.toMatch(/private-|untrusted-id|questionId|sourceIds|review/);
    }
    expect(sawLiveBody).toBe(true);
    expect(C.researchReportPreview(publicText).sections).toEqual([{ sectionId: "trusted-section", body: 'First "quoted" 😀 prose\n\nNext paragraph' }]);
  });
  it("resets projection when an actual attempt is discarded, without replaying old prose", async () => {
    let text = "";
    const publish = questionParagraphStream("a", async delta => { text += delta; });
    await publish('{"paragraphs":[{"body":"Old prose');
    text = ""; publish.reset();
    await publish('{"paragraphs":[{"body":"New prose');
    expect(text).toBe('{"sectionId":"a","body":"New prose');
  });
  it("projects optional fenced chapter JSON incrementally before its final closing fence", async () => {
    let text = '{"sections":[';
    const publish = questionParagraphStream("a", async delta => { text += delta; });
    const raw = '```json\n{"sectionId":"private-section","paragraphs":[{"questionId":"private-binding","body":"Fenced live prose"}]}\n```';
    for (let i = 0; i < raw.length; i++) {
      await publish(raw[i]!);
      expect(text).not.toMatch(/private-|questionId|paragraphs|```/);
      if (i === raw.indexOf(" prose") + 5) expect(C.researchReportPreview(text).sections[0]?.body).toBe("Fenced live prose");
    }
    expect(C.researchReportPreview(text).sections).toEqual([{ sectionId: "a", body: "Fenced live prose" }]);
  });
});
