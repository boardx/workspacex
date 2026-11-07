/** DeepAgents 0.7 ToolMessage.status reports transport; execute's artifact owns command exit. */
export function deepAgentToolResultSucceeded(toolName: string, message: { readonly status?: unknown; readonly artifact?: unknown }): boolean {
  if (message.status === "error") return false;
  if (toolName !== "execute") return true;
  const artifact = message.artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false;
  const code = (artifact as Record<string, unknown>).exit_code;
  // Missing/unknown/cancelled executions never become a confirmed command success.
  return typeof code === "number" && Number.isInteger(code) && code === 0;
}
