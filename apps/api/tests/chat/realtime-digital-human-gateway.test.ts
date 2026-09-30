/**
 * `WS /chat/realtime-digital-human` —— Chat 语音模式（ADR-121）网关测试。
 *
 * 裸 `http.Server` + 网关 + 一个本地假上游（模拟 DashScope realtime WS），会话端口用假实现：
 * 握手鉴权、fail-closed 错误映射、音色/指令只来自服务端、转写落库、未配置友好错误。
 * 判权/人设解析本身的规则在 `realtime-voice-session.test.ts` 单测。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { chat as C } from "@repo/contracts";
import { attachRealtimeDigitalHumanGateway, readRealtimeModelConfig, type RealtimeModelConfig } from "../../src/interface/ws/realtime-digital-human.gateway";
import {
  RealtimeVoiceAgentUnavailableError,
  RealtimeVoiceThreadUnavailableError,
  type RealtimeVoiceSession,
  type RealtimeVoiceSessionPort,
} from "../../src/application/chat/realtime-voice-session";
import type { PrincipalResolverPort } from "../../src/application/ports/principal-resolver.port";

const STREAM = C.streamOperations.realtimeDigitalHuman;
const TOKEN = "valid-token";

class FakePrincipals implements PrincipalResolverPort {
  async resolve(headers: { authorization?: string }) {
    return headers.authorization === `Bearer ${TOKEN}` ? ({ userId: "u-1", orgId: "org-1" } as never) : null;
  }
}

class FakeVoice implements RealtimeVoiceSessionPort {
  opened: Array<{ threadId: string; agentId: string | null; userId: string; orgId: string }> = [];
  appended: Array<{ role: string; text: string }> = [];
  failWith: Error | null = null;
  async open(input: { orgId: string; userId: string; threadId: string; agentId: string | null }): Promise<RealtimeVoiceSession> {
    this.opened.push(input as never);
    if (this.failWith) throw this.failWith;
    return {
      orgId: input.orgId as never, userId: input.userId, threadId: input.threadId,
      role: { agentId: input.agentId, name: "研究员小周", duty: "行业研究", tags: [], avatarKey: "dh-01", roleCategory: "research" },
      instructions: "SERVER-INSTRUCTIONS 研究员小周",
      voice: "ServerVoice",
    };
  }
  async append(_session: RealtimeVoiceSession, turn: { role: "user" | "assistant"; text: string }) {
    this.appended.push(turn);
    return `m-${this.appended.length}`;
  }
}

function listen(server: Server | WebSocketServer): Promise<number> {
  return new Promise((resolve) => {
    if (server instanceof WebSocketServer) {
      server.once("listening", () => resolve((server.address() as AddressInfo).port));
      return;
    }
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

interface Collected { frames: Array<Record<string, unknown>>; closed: Promise<void> }

async function connect(port: number, protocols: string[] = [`${STREAM.bearerSubprotocolPrefix}${TOKEN}`]): Promise<{ ws: WebSocket } & Collected> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${STREAM.path}`, protocols);
  const frames: Array<Record<string, unknown>> = [];
  ws.on("message", (raw) => frames.push(JSON.parse(String(raw))));
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return { ws, frames, closed };
}

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("WS /chat/realtime-digital-human — Chat 语音模式", () => {
  let server: Server;
  let port: number;
  let upstream: WebSocketServer;
  let upstreamSockets: WebSocket[];
  let upstreamMessages: Array<Record<string, unknown>>;
  let upstreamUrls: string[];
  let voice: FakeVoice;
  let config: RealtimeModelConfig;

  beforeEach(async () => {
    upstreamSockets = [];
    upstreamMessages = [];
    upstreamUrls = [];
    upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    upstream.on("connection", (socket, request) => {
      upstreamSockets.push(socket);
      upstreamUrls.push(`${request.url} ${String(request.headers.authorization)}`);
      socket.on("message", (raw) => {
        const event = JSON.parse(String(raw)) as Record<string, unknown>;
        upstreamMessages.push(event);
        if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      });
    });
    const upstreamPort = await listen(upstream);
    config = {
      baseUrl: `ws://127.0.0.1:${upstreamPort}/realtime`, apiKey: "sk-test", model: "qwen-test-realtime",
      defaultVoice: "Maia", voiceMap: {},
    };
    voice = new FakeVoice();
    server = createServer();
    attachRealtimeDigitalHumanGateway(server, { principals: new FakePrincipals(), voice, config: () => config });
    port = await listen(server);
  });

  afterEach(async () => {
    for (const socket of upstreamSockets) socket.terminate();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses the handshake without a bearer subprotocol or with an unknown token", async () => {
    await expect(connect(port, [])).rejects.toBeDefined();
    await expect(connect(port, [`${STREAM.bearerSubprotocolPrefix}nope`])).rejects.toBeDefined();
    expect(voice.opened).toHaveLength(0);
  });

  it("resolves the persona on the server from principal + threadId + agentId; model and voice never come from the client", async () => {
    const { ws, frames } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1", agentId: "agent-dh-01" }));
    await until(() => frames.some((f) => f.type === "session.ready"));
    expect(voice.opened).toEqual([{ orgId: "org-1", userId: "u-1", threadId: "t-1", agentId: "agent-dh-01" }]);
    const update = upstreamMessages.find((m) => m.type === "session.update") as { session: { instructions: string; audio: { output: { voice: string } } } };
    expect(update.session.instructions).toBe("SERVER-INSTRUCTIONS 研究员小周");
    expect(update.session.audio.output.voice).toBe("ServerVoice");
    expect(upstreamUrls[0]).toBe("/realtime?model=qwen-test-realtime Bearer sk-test");
    expect(frames.find((f) => f.type === "session.ready")).toEqual({ type: "session.ready", model: "qwen-test-realtime" });
    ws.close();
  });

  it("rejects client attempts to smuggle model/voice (strict frame) with INVALID_FRAME", async () => {
    const { ws, frames } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1", voice: "Evil", model: "gpt" }));
    await until(() => frames.length > 0);
    expect(frames[0]).toMatchObject({ type: "session.error", reason: "INVALID_FRAME" });
    expect(voice.opened).toHaveLength(0);
    ws.close();
  });

  it("requires exactly one of boardId / threadId", async () => {
    const { ws, frames } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1", boardId: "b-1" }));
    await until(() => frames.length > 0);
    expect(frames[0]).toMatchObject({ type: "session.error", reason: "INVALID_FRAME" });
    expect(upstreamSockets).toHaveLength(0);
    ws.close();
  });

  it.each([
    [new RealtimeVoiceAgentUnavailableError(), "AGENT_UNAVAILABLE"],
    [new RealtimeVoiceThreadUnavailableError(), "THREAD_UNAVAILABLE"],
  ])("fails closed (%s) — no upstream connection, friendly reason, socket closed", async (error, reason) => {
    voice.failWith = error;
    const { ws, frames, closed } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1", agentId: "hidden" }));
    await closed;
    expect(frames[0]).toMatchObject({ type: "session.error", reason });
    expect(String(frames[0]!.message)).not.toMatch(/Error|realtime_voice/);
    expect(upstreamSockets).toHaveLength(0);
  });

  it("fails closed when the gateway has no voice port wired (Chat host)", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer();
    attachRealtimeDigitalHumanGateway(server, { principals: new FakePrincipals(), config: () => config });
    port = await listen(server);
    const { ws, frames, closed } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1" }));
    await closed;
    expect(frames[0]).toMatchObject({ type: "session.error", reason: "THREAD_UNAVAILABLE" });
  });

  it("persists completed user and assistant turns (and an interrupted assistant draft) as thread messages", async () => {
    const { ws, frames } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1", agentId: null }));
    await until(() => frames.some((f) => f.type === "session.ready"));
    const up = upstreamSockets[0]!;
    up.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "帮我总结一下本周进展" }));
    up.send(JSON.stringify({ type: "response.audio_transcript.delta", delta: "好的，" }));
    up.send(JSON.stringify({ type: "response.audio_transcript.delta", delta: "本周完成了三件事。" }));
    up.send(JSON.stringify({ type: "response.audio_transcript.done", transcript: "好的，本周完成了三件事。" }));
    // barge-in: assistant speaking, user interrupts → partial draft persisted once
    up.send(JSON.stringify({ type: "response.audio_transcript.delta", delta: "第一件是" }));
    up.send(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    up.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "   " }));
    await until(() => frames.filter((f) => f.type === "turn.persisted").length === 3);
    expect(voice.appended).toEqual([
      { role: "user", text: "帮我总结一下本周进展" },
      { role: "assistant", text: "好的，本周完成了三件事。" },
      { role: "assistant", text: "第一件是" },
    ]);
    expect(frames.filter((f) => f.type === "turn.persisted").map((f) => f.role)).toEqual(["user", "assistant", "assistant"]);
    expect(frames).toContainEqual({ type: "user.transcript", text: "帮我总结一下本周进展", final: true });
    expect(frames).toContainEqual({ type: "user.speech_started" });
    ws.close();
  });

  it("maps upstream errors to a friendly UPSTREAM_FAILED without leaking provider details", async () => {
    const { ws, frames } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", threadId: "t-1" }));
    await until(() => frames.some((f) => f.type === "session.ready"));
    upstreamSockets[0]!.send(JSON.stringify({ type: "error", error: { code: "InvalidApiKey", message: "secret detail" } }));
    await until(() => frames.some((f) => f.type === "session.error"));
    const error = frames.find((f) => f.type === "session.error")!;
    expect(error.reason).toBe("UPSTREAM_FAILED");
    expect(JSON.stringify(error)).not.toContain("secret detail");
    ws.close();
  });

  it("reports NOT_CONFIGURED (friendly text) when no realtime model is configured", async () => {
    config = { ...config, apiKey: undefined };
    const { frames, closed } = await connect(port);
    await closed;
    expect(frames).toEqual([{ type: "session.error", reason: "NOT_CONFIGURED", message: "实时语音模型尚未配置，请联系管理员" }]);
  });

  it("keeps the whiteboard POC path working (boardId, default voice, no persistence)", async () => {
    const { ws, frames } = await connect(port);
    ws.send(JSON.stringify({ type: "session.start", boardId: "board-9" }));
    await until(() => frames.some((f) => f.type === "session.ready"));
    const update = upstreamMessages.find((m) => m.type === "session.update") as { session: { instructions: string; audio: { output: { voice: string } } } };
    expect(update.session.instructions).toContain("board-9");
    expect(update.session.audio.output.voice).toBe("Maia");
    upstreamSockets[0]!.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "你好" }));
    await until(() => frames.some((f) => f.type === "user.transcript"));
    expect(voice.opened).toHaveLength(0);
    expect(voice.appended).toHaveLength(0);
    ws.close();
  });

  it("reads voice map + default voice from env (single deployment source)", () => {
    const parsed = readRealtimeModelConfig({
      KERNEL_OMNI_REALTIME_API_KEY: "k", KERNEL_OMNI_REALTIME_BASE_URL: "wss://x",
      KERNEL_OMNI_REALTIME_VOICE_MAP: JSON.stringify({ research: "Cherry", "dh-02": "bad voice!" }),
    } as never);
    expect(parsed.defaultVoice).toBe("Maia");
    expect(parsed.model).toBe("qwen3.8-omni-flash-realtime");
    expect(parsed.voiceMap).toEqual({ research: "Cherry" });
  });
});
