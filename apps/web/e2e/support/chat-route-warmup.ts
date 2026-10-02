export const CHAT_ROUTE_WARMUP_BUDGET_MS = 300_000;

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
