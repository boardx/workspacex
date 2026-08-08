/**
 * issue #726 —— `WS /chat/asr-draft`：composer 麦克风的草稿 ASR 面。
 *
 * 只起一个裸 `http.Server` + `attachAsrDraftGateway`，用假的 `PrincipalResolverPort`/
 * `AsrProviderPort` 驱动——不需要数据库、不需要 recording_sessions，这正是这条面与
 * 姊妹面（`asr-stream.gateway.ts`，需要真实会话/项目角色）的核心区别，也是测试能这么
 * 轻量的原因。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { chat as C } from "@repo/contracts";
import { attachAsrDraftGateway } from "../../src/interface/ws/asr-draft.gateway";
import { AsrNotConfiguredError, type AsrProviderPort, type AsrSessionHandlers } from "../../src/application/recording/asr-ports";
import type { PrincipalResolverPort } from "../../src/application/ports/principal-resolver.port";

const BEARER_PREFIX = C.streamOperations.streamAsrDraft.bearerSubprotocolPrefix;
const VALID_TOKEN = "valid-session-token";

class FakePrincipalResolver implements PrincipalResolverPort {
  async resolve(headers: { authorization?: string }) {
    const token = headers.authorization?.replace(/^Bearer /, "");
    if (token !== VALID_TOKEN) return null;
    return { userId: "user-1", orgId: "org-1" } as never;
  }
}

/** Emits one partial then one final for every `open()` call, unless `configured` is false. */
class FakeAsrProvider implements AsrProviderPort {
  configured = true;
  lastHandlers: AsrSessionHandlers | null = null;

  isConfigured(): boolean {
    return this.configured;
  }

  async open(handlers: AsrSessionHandlers) {
    if (!this.configured) throw new AsrNotConfiguredError("KERNEL_ASR_PROVIDER");
    this.lastHandlers = handlers;
    return {
      pushAudio: () => {},
      commit: () => {},
      finish: async () => { handlers.onClosed(); },
      abort: () => {},
    };
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

function connect(port: number, protocols?: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${C.streamOperations.streamAsrDraft.path}`, protocols);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextFrame(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(String(raw))));
  });
}

function nextClose(ws: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve({ code }));
  });
}

describe("WS /chat/asr-draft (issue #726)", () => {
  let server: Server;
  let port: number;
  let provider: FakeAsrProvider;

  beforeEach(async () => {
    server = createServer();
    provider = new FakeAsrProvider();
    attachAsrDraftGateway(server, { principals: new FakePrincipalResolver(), asr: provider });
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses the handshake (no WS connection) when no bearer subprotocol is offered", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${C.streamOperations.streamAsrDraft.path}`);
    const failure = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(failure).toBeDefined();
  });

  it("refuses the handshake when the bearer token does not resolve to a principal", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}${C.streamOperations.streamAsrDraft.path}`,
      [`${BEARER_PREFIX}not-a-real-token`],
    );
    const failure = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(failure).toBeDefined();
  });

  it("streams asr.partial then asr.final WITHOUT a segmentId — the draft never touches the database", async () => {
    const ws = await connect(port, [`${BEARER_PREFIX}${VALID_TOKEN}`]);
    ws.send(JSON.stringify({ type: "asr.start" }));
    await new Promise((resolve) => setTimeout(resolve, 20)); // let `open()` resolve

    provider.lastHandlers?.onPartial({ text: "你好", confidence: null });
    const partial = await nextFrame(ws);
    expect(partial).toEqual({ type: "asr.partial", text: "你好" });

    provider.lastHandlers?.onFinal({ text: "你好世界", confidence: 0.9 });
    const final = await nextFrame(ws);
    // ⚠ 核心断言：草稿流的 `asr.final` 没有 `segmentId` —— 与姊妹面
    //   `asr-stream.gateway.ts` 的 `asr.final`（必带落库后的 segmentId）刻意不同。
    expect(final).toEqual({ type: "asr.final", text: "你好世界" });
    expect(final).not.toHaveProperty("segmentId");

    ws.close();
  });

  it("reports ASR_NOT_CONFIGURED honestly instead of silently failing when the provider isn't configured", async () => {
    provider.configured = false;
    const ws = await connect(port, [`${BEARER_PREFIX}${VALID_TOKEN}`]);
    ws.send(JSON.stringify({ type: "asr.start" }));

    const frame = await nextFrame(ws);
    expect(frame).toEqual({ type: "asr.error", reason: "ASR_NOT_CONFIGURED" });
    await nextClose(ws);
  });

  it("finishes cleanly on asr.finish without waiting on any persistence queue", async () => {
    const ws = await connect(port, [`${BEARER_PREFIX}${VALID_TOKEN}`]);
    ws.send(JSON.stringify({ type: "asr.start" }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    ws.send(JSON.stringify({ type: "asr.finish" }));
    const frame = await nextFrame(ws);
    expect(frame).toEqual({ type: "asr.finished" });
    await nextClose(ws);
  });
});
