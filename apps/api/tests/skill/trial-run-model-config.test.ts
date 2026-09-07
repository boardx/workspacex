import { describe, expect, it } from "vitest";
import { readSkillTrialRunModelConfig } from "../../src/infrastructure/skill/trial-run-model-config";

describe("readSkillTrialRunModelConfig", () => {
  it("uses the explicitly configured trial-run model before the general model", () => {
    expect(readSkillTrialRunModelConfig({
      KERNEL_MODEL_PROVIDER: "dashscope",
      KERNEL_MODEL_ID: "qwen-general",
      KERNEL_SKILL_TRIALRUN_MODEL_ID: "qwen-trial-run",
    })).toEqual({ provider: "dashscope", modelId: "qwen-trial-run" });
  });

  it("uses the configured general model when no trial-run override exists", () => {
    expect(readSkillTrialRunModelConfig({
      KERNEL_MODEL_PROVIDER: "dashscope",
      KERNEL_MODEL_ID: "qwen-general",
    })).toEqual({ provider: "dashscope", modelId: "qwen-general" });
  });

  it("treats a blank trial-run override as absent", () => {
    expect(readSkillTrialRunModelConfig({
      KERNEL_MODEL_PROVIDER: "dashscope",
      KERNEL_MODEL_ID: "qwen-general",
      KERNEL_SKILL_TRIALRUN_MODEL_ID: "   ",
    })).toEqual({ provider: "dashscope", modelId: "qwen-general" });
  });

  it("trims values and stays unconfigured when neither model id is declared", () => {
    expect(readSkillTrialRunModelConfig({
      KERNEL_MODEL_PROVIDER: " dashscope ",
      KERNEL_MODEL_ID: "   ",
      KERNEL_SKILL_TRIALRUN_MODEL_ID: " ",
    })).toEqual({ provider: "dashscope", modelId: "" });
  });
});
