/**
 * 启动时那一次真实调用。测的是「失败时说了什么」——因为这整件事的价值就在这里：
 * 同样一个「模型用不了」，在启动日志里说清楚，和让用户在聊天框里撞一次再猜，
 * 差别是用户知不知道下一步该做什么。
 */
import { describe, expect, it } from "vitest";
import { probeChatModel, probeEmbeddingModel } from "../src/model-preflight";

const base = { baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama-local", model: "qwen3.5:4b" };

function stub(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as unknown as typeof fetch;
}

describe("model preflight", () => {
  it("sends a one-token completion to the OpenAI-compatible path", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const result = await probeChatModel({
      ...base,
      fetchImpl: stub((url, init) => {
        seenUrl = url;
        seenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response("{}", { status: 200 });
      }),
    });
    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("http://127.0.0.1:11434/v1/chat/completions");
    // 一个 token、不流式：这是一次验证，不该占着本地模型做别的事
    expect(seenBody.max_tokens).toBe(1);
    expect(seenBody.stream).toBe(false);
    expect(seenBody.model).toBe("qwen3.5:4b");
  });

  it("passes the server's own words through -- they beat anything we could invent", async () => {
    const result = await probeChatModel({
      ...base,
      fetchImpl: stub(() => new Response('{"error":{"message":"model \\"qwen3.5:4b\\" not found"}}', { status: 404 })),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("HTTP 404");
    expect(result.detail).toContain("not found");
  });

  it("says what a timeout actually means on this kind of machine", async () => {
    const result = await probeChatModel({
      ...base,
      timeoutMs: 50,
      // 真的尊重 AbortSignal：超时是 fetch 侧的机制，stub 不照做就测不到那条路径。
      fetchImpl: stub((_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted due to timeout")));
      })),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/没有响应/);
    expect(result.detail).toMatch(/内存不足/);
  });

  it("probes embeddings separately -- the chat call proves nothing about them", async () => {
    let seenUrl = "";
    await probeEmbeddingModel({
      ...base,
      model: "qwen3-embedding:0.6b",
      fetchImpl: stub((url) => { seenUrl = url; return new Response("{}", { status: 200 }); }),
    });
    expect(seenUrl).toBe("http://127.0.0.1:11434/v1/embeddings");
  });
});
