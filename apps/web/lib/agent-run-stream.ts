/**
 * #654 阶段2d —— `GET /agent-runs/:runId/stream` 的客户端薄封装。
 *
 * ## 为什么是新文件，不是塞进 `agent-run.ts`
 *
 * `agent-run.ts` 的文件头把自己的范围写死为「轮询，不是 SSE……本文件只提供单次读」。
 * 那句声明现在仍然对 `getAgentRun` 本身成立——`GET /agent-runs/:runId` 这个端点、
 * 以及消费它的有界退避轮询循环，一个字节都没有改变（`agent-run-stream-endpoint.test.ts`
 * 的第一句话）。SSE 是**加出来的第二条**观测路径，不是对第一条的改写；混进同一个文件会
 * 让那句范围声明变成一句说谎的注释——本仓已经因为这个模式踩过很多次。
 *
 * ## 用 `fetch` + `ReadableStream`，不用 `EventSource`
 *
 * 鉴权是 `Authorization: Bearer <token>` 头（`api-client.ts` 头注），而
 * `EventSource` 浏览器原生 API **不支持自定义请求头**——这是 `copilotkit-preview-panel.tsx`
 * 已经踩过、写在它自己文件头里的同一个坑（它用 `@ag-ui/client` 的 `HttpAgent` 绕开；
 * 这里量级更小，直接手写 `fetch` + 流式读取，不为了这一个端点多装一个包）。
 *
 * ## 帧解析：与后端 `agent-run.controller.ts` 的 `write()` 逐字对应
 *
 * 后端只发三种 `data: {...}\n\n` 形状：`{type:"delta",text}` /
 * `{type:"final",status,resultMessageId?,error?}` / `{type:"timeout"}`。
 * 这里的 `AgentRunStreamEvent` union 就是那三种形状的客户端投影，字段名逐一对应，
 * 不是重新设计一套。
 */
import { apiUrl, getStoredSessionToken } from "./api-client";

export type AgentRunStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "final"; readonly status: "succeeded"; readonly resultMessageId: string | null }
  | { readonly type: "final"; readonly status: "failed"; readonly error: string | null }
  | { readonly type: "timeout" };

function parseFrame(raw: string): AgentRunStreamEvent | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "") return null;
  try {
    return JSON.parse(payload) as AgentRunStreamEvent;
  } catch {
    // A malformed frame is a wire hiccup, not proof the whole connection is unusable --
    // same discipline as the backend adapter's own SSE parser
    // (`configured-model-provider.ts`'s `streamImpl`): skip it, keep reading.
    return null;
  }
}

/**
 * Opens the stream and calls `onEvent` for every frame, in order, until the connection
 * ends (server closed it after a `final`/`timeout` event) or `signal` aborts it.
 *
 * Resolves normally on a clean end. Rejects only for a genuine failure to even open the
 * connection (network error, non-200 status) -- the caller decides what "could not stream"
 * means for its own UI (this file has no opinion on falling back to polling).
 */
export async function openAgentRunStream(
  runId: string,
  onEvent: (event: AgentRunStreamEvent) => void,
  options: { readonly sessionToken?: string | null; readonly signal?: AbortSignal } = {},
): Promise<void> {
  const token = options.sessionToken !== undefined ? options.sessionToken : getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(apiUrl(`/agent-runs/${encodeURIComponent(runId)}/stream`), {
    method: "GET",
    headers,
    credentials: "include",
    signal: options.signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(`agent run stream failed with HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      const event = parseFrame(frame);
      if (event) onEvent(event);
    }
  }
}
