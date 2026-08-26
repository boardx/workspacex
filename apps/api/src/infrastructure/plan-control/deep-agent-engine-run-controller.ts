/**
 * `EngineRunController` implementation for F976 UC-9 `pausePlanRun`.
 *
 * Deliberately a THIN, standalone fetch call -- does not reach into
 * `DeepAgentModelProvider`'s internals (that class already carries the full turn
 * lifecycle: message-building, polling, streaming, HITL resume; adding a cancel path
 * into it would touch a large, already-signed-off, heavily-tested surface for one new
 * method that shares none of that machinery). Reuses `readDeepAgentProviderConfig`
 * (base URL / timeout config) and `deriveRemoteThreadId` (the deterministic chat-thread
 * → remote-thread mapping) from that same file, since inventing a second copy of either
 * is exactly the kind of drift this repo's CLAUDE.md calls out by name.
 */
import type { EngineRunController } from "../../application/plan-control/engine-run-controller-port";
import { deriveRemoteThreadId, readDeepAgentProviderConfig } from "../agent-run/deep-agent-model-provider";

export class DeepAgentEngineRunController implements EngineRunController {
  async cancelRun(chatThreadId: string, remoteRunId: string): Promise<void> {
    const { baseUrl, timeoutMs } = readDeepAgentProviderConfig();
    const remoteThreadId = deriveRemoteThreadId(chatThreadId);
    if (baseUrl === "") {
      throw new Error("KERNEL_DEEP_AGENT_BASE_URL is not set for this deployment");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `${baseUrl}/threads/${remoteThreadId}/runs/${remoteRunId}/cancel?action=interrupt`,
        { method: "POST", signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`deep agent cancel failed with HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
