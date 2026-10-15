export const CHAT_ROUTE_WARMUP_BUDGET_MS = 300_000;

/** Public fixed-code cause metadata only; never logs URL, message or stack. */
export function warmupFailureDiagnostic(failure: unknown) {
  const allowed = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ABORT_ERR"]);
  const types = new Set(["Error", "TypeError", "AbortError", "TimeoutError"]);
  const e = failure instanceof Error ? failure : undefined;
  let cause: any = failure, errorCode: string | null = null;
  const seen = new Set();
  for (let i = 0; i < 3 && cause && typeof cause === "object" && !seen.has(cause); i++, cause = cause.cause) {
    seen.add(cause);
    if (typeof cause.code === "string" && allowed.has(cause.code)) errorCode = cause.code;
  }
  return { kind: "chat-warmup-failure-v1", errorType: e && types.has(e.name) ? e.name : "Unknown", errorCode };
}

/** A stalled HTTP request must consume, rather than bypass, the route budget. */
export async function warmChatRoute(
  url: string,
  budgetMs = CHAT_ROUTE_WARMUP_BUDGET_MS,
  retryDelayMs = 2_000,
): Promise<void> {
  const deadline = performance.now() + budgetMs;
  let lastOutcome = "never attempted";
  for (;;) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) {
      throw new Error(`[chat-route-warmup] ${url} did not become ready within ${budgetMs}ms: ${lastOutcome}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.ceil(remainingMs));
    try {
      const response = await fetch(url, { redirect: "manual", signal: controller.signal });
      const status = response.status;
      await response.body?.cancel();
      if (status < 500 && performance.now() < deadline) return;
      lastOutcome = `HTTP ${status}`;
    } catch (failure) {
      console.log("[chat-route-warmup-diagnostic] " + JSON.stringify(warmupFailureDiagnostic(failure)));
      lastOutcome = controller.signal.aborted && lastOutcome !== "never attempted"
        ? `${lastOutcome}; request exceeded remaining route budget`
        : failure instanceof Error ? failure.message : String(failure);
    } finally {
      clearTimeout(timer);
    }
    const retryBudgetMs = deadline - performance.now();
    if (retryBudgetMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, retryBudgetMs)));
    }
  }
}
