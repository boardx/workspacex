export function readDigitalInterviewModelConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    modelId: (
      env.KERNEL_DIGITAL_INTERVIEW_SKILL_MODEL_ID
      ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID
      ?? env.KERNEL_MODEL_ID
      ?? "default"
    ).trim() || "default",
  };
}
