/** Adapter-owned diagnostic metadata; never upstream prose or request data. */
export const MODEL_PROVIDER_FAILURE_KINDS = ["configuration", "http", "timeout", "abort", "transport", "empty_output", "invalid_response", "unknown"] as const;
export type ModelProviderFailure = { readonly kind: typeof MODEL_PROVIDER_FAILURE_KINDS[number]; readonly status?: number };

/** Rebuild the allowlisted shape; untyped adapters/getters cannot leak or break callers. */
export function safeModelProviderFailure(value: unknown): ModelProviderFailure {
  try {
    const input = value as ModelProviderFailure | undefined;
    const kind = input?.kind;
    if (!kind || !MODEL_PROVIDER_FAILURE_KINDS.includes(kind)) return { kind: "unknown" };
    if (kind === "http") {
      const status = input?.status;
      return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
        ? { kind: "http", status } : { kind: "unknown" };
    }
    return { kind };
  } catch { return { kind: "unknown" }; }
}
