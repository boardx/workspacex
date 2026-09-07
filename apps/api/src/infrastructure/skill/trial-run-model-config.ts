export interface SkillTrialRunModelConfig {
  readonly provider: string;
  readonly modelId: string;
}

/**
 * Skill trial runs use the deployment's configured single-turn completion provider.
 * A dedicated model id can override the general model, while an absent override reuses
 * the explicitly configured general model id. Neither source has an implicit default:
 * an unconfigured deployment remains unavailable at call time.
 */
export function readSkillTrialRunModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): SkillTrialRunModelConfig {
  const dedicatedModelId = (env.KERNEL_SKILL_TRIALRUN_MODEL_ID ?? "").trim();
  const generalModelId = (env.KERNEL_MODEL_ID ?? "").trim();
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    modelId: dedicatedModelId || generalModelId,
  };
}
