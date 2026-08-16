import { describe, expect, it } from "vitest";

import { readDigitalInterviewModelConfig } from "../../src/infrastructure/interview/workflow/digital-interview-model-config";

describe("digital interview model config", () => {
  it("uses the deployed default agent model for expert generation and Skill chat", () => {
    expect(readDigitalInterviewModelConfig({
      KERNEL_MODEL_PROVIDER: "openai-compatible",
      KERNEL_DEFAULT_AGENT_MODEL_ID: "gpt-interview",
    })).toEqual({
      provider: "openai-compatible",
      modelId: "gpt-interview",
    });
  });

  it("keeps the interview-specific model override", () => {
    expect(readDigitalInterviewModelConfig({
      KERNEL_MODEL_PROVIDER: "openai-compatible",
      KERNEL_DEFAULT_AGENT_MODEL_ID: "gpt-default",
      KERNEL_DIGITAL_INTERVIEW_SKILL_MODEL_ID: "gpt-interview",
    })).toEqual({
      provider: "openai-compatible",
      modelId: "gpt-interview",
    });
  });
});
