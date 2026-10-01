import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tagInputLimits } from "../src/tag-input-limits";
import { GuidedResearchMetadata } from "../src/research";
import { SurveyTagsSchema } from "../src/survey-source";
import { operations as transcription } from "../src/personal-realtime-transcription";
import { DigitalInterviewDraftInput, operations as interview } from "../src/interview";

const schemas = [GuidedResearchMetadata.shape.tags, SurveyTagsSchema, transcription.createPersonalTranscription.in.shape.tags, interview.updateDigitalInterviewMetadata.in.shape.tags];

describe("tag input limits are derived from the operation contract", () => {
  it.each(schemas)("matches the accepted boundary and rejects both overflowing dimensions", (schema) => {
    const limits = tagInputLimits(schema);
    expect(limits.maxTags).toBeGreaterThan(0);
    expect(limits.maxTagLength).toBeGreaterThan(0);
    const tags = Array.from({ length: limits.maxTags! }, (_, i) => String(i).padEnd(limits.maxTagLength!, "x"));
    expect(schema.safeParse(tags).success).toBe(true);
    expect(schema.safeParse([...tags, "extra"]).success).toBe(false);
    expect(schema.safeParse(["x".repeat(limits.maxTagLength! + 1)]).success).toBe(false);
  });

  it("preserves unbounded interview creation instead of imposing another domain's limits", () => {
    expect(tagInputLimits(DigitalInterviewDraftInput.shape.tags)).toEqual({ maxTags: undefined, maxTagLength: undefined });
    expect(DigitalInterviewDraftInput.shape.tags.safeParse(Array.from({ length: 40 }, (_, i) => `${i}${"x".repeat(90)}`)).success).toBe(true);
  });

  it("unwraps refinement/default/optional without changing the schema", () => {
    const schema = z.array(z.string().max(7)).max(3).refine(tags => tags.length > 0).default([]).optional();
    expect(tagInputLimits(schema)).toEqual({ maxTags: 3, maxTagLength: 7 });
    expect(() => tagInputLimits(z.string())).toThrow("array of strings");
  });
});
