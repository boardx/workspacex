/** Monetary facts use integer micro-units and explicit immutable price versions. */
export interface AiPrice {
  readonly version: string;
  readonly currency: string;
  readonly inputMicrosPerMillion: bigint;
  readonly outputMicrosPerMillion: bigint;
  readonly cachedInputMicrosPerMillion?: bigint;
}
export interface AiTokenCounts {
  readonly input: bigint;
  readonly output: bigint;
  /** Cached input is a subset of input, never added again. */
  readonly cachedInput?: bigint;
  /** Reasoning is a subset of output, never added again. */
  readonly reasoningOutput?: bigint;
}
export function priceAiTokens(price: AiPrice, usage: AiTokenCounts): bigint {
  const cached = usage.cachedInput ?? 0n;
  if (!price.version || !price.currency || price.inputMicrosPerMillion < 0n || price.outputMicrosPerMillion < 0n
    || (price.cachedInputMicrosPerMillion !== undefined && price.cachedInputMicrosPerMillion < 0n)
    || usage.input < 0n || usage.output < 0n || cached < 0n || cached > usage.input
    || (usage.reasoningOutput !== undefined && (usage.reasoningOutput < 0n || usage.reasoningOutput > usage.output))) {
    throw new Error("INVALID_AI_PRICE_OR_USAGE");
  }
  // A missing cache-specific rate is unknown, not a free cache assumption.
  if (cached > 0n && price.cachedInputMicrosPerMillion === undefined) throw new Error("AI_CACHE_PRICE_UNCONFIGURED");
  const numerator = (usage.input - cached) * price.inputMicrosPerMillion
    + cached * (price.cachedInputMicrosPerMillion ?? price.inputMicrosPerMillion)
    + usage.output * price.outputMicrosPerMillion;
  return (numerator + 999_999n) / 1_000_000n;
}

export interface AiBudgetState {
  readonly plan: "ordinary" | "enterprise" | null;
  readonly tokenLimit: bigint | null;
  readonly costLimitMicros: bigint | null;
  readonly usedTokens: bigint;
  readonly heldTokens: bigint;
  readonly usedCostMicros: bigint;
  readonly heldCostMicros: bigint;
}
export type AiAdmissionDecision = "allowed" | "PLAN_UNCONFIGURED" | "TOKEN_LIMIT_UNCONFIGURED"
  | "AI_LIMIT_RULE_BLOCKED" | "AI_LIMIT_APPROVAL_REQUIRED" | "AI_TOKEN_DEGRADE_REQUIRED" | "AI_ATTEMPT_LIMIT_REACHED" | "COST_LIMIT_UNCONFIGURED" | "BUDGET_WINDOW_INACTIVE" | "TOKEN_LIMIT_REACHED" | "COST_LIMIT_REACHED";
/** Caller must apply this inside the shared budget lock, then persist the hold atomically. */
export function decideAiAdmission(state: AiBudgetState, maximumTokens: bigint, maximumCostMicros: bigint, tokenBilling:"token"|"not-applicable"="token"): AiAdmissionDecision {
  const values = [state.usedTokens, state.heldTokens, state.usedCostMicros, state.heldCostMicros, maximumTokens, maximumCostMicros];
  if (values.some(n => n < 0n) || (state.tokenLimit !== null && state.tokenLimit < 0n)
    || (state.costLimitMicros !== null && state.costLimitMicros < 0n)) throw new Error("INVALID_AI_BUDGET");
  if (state.plan === null) return "PLAN_UNCONFIGURED";
  if(tokenBilling==="not-applicable"&&maximumTokens!==0n)throw new Error("INVALID_AI_NATIVE_TOKEN_BOUND");
  if (tokenBilling==="token"&&state.plan === "ordinary" && state.tokenLimit === null) return "TOKEN_LIMIT_UNCONFIGURED";
  if (state.costLimitMicros === null) return "COST_LIMIT_UNCONFIGURED";
  if (tokenBilling==="token"&&state.plan === "ordinary" && state.usedTokens + state.heldTokens + maximumTokens > state.tokenLimit!) return "TOKEN_LIMIT_REACHED";
  if (state.usedCostMicros + state.heldCostMicros + maximumCostMicros > state.costLimitMicros) return "COST_LIMIT_REACHED";
  return "allowed";
}
