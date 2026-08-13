import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { AsrProviderPort, AsrSessionHandlers } from "../../src/application/recording/asr-ports";
import type { PersonalTranscriptionRepository } from "../../src/application/recording/personal-transcription-ports";
import type { AsrUsageEvent, AsrUsageMeter, RealtimeAsrTicketStore } from "../../src/application/recording/personal-realtime-asr";
import type { IdGenerator } from "../../src/application/recording/ports";
import { attachPersonalRealtimeAsrGateway } from "../../src/interface/ws/personal-realtime-asr.gateway";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-personal-asr-gateway");
const TRANSCRIPTION = "transcription-1";
const CAPTURE = "capture-1";
const OWNER = "user-1";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe("personal realtime ASR gateway", () => {
  it("streams shared provider events, persists final before publish, and meters accepted PCM", async () => {
    const trace: string[] = [];
    const usage: AsrUsageEvent[] = [];
    let handlers: AsrSessionHandlers | undefined;
    let format: unknown;
    const provider: AsrProviderPort = {
      isConfigured: () => true,
      open: async (nextHandlers, audio) => {
        handlers = nextHandlers;
        format = audio;
        return {
          pushAudio: () => trace.push("audio"),
          commit: () => undefined,
          finish: async () => {
            nextHandlers.onFinal({ text: "最终文本", confidence: null });
          },
          abort: () => trace.push("abort"),
        };
      },
    };
    const repository = repositoryStub({
      appendFinal: async () => { trace.push("persist-final"); },
      finishCapture: async () => { trace.push("finish-capture"); },
    });
    const client = await connect({ provider, repository, usage: usageMeter(usage) });
    client.ws.send(JSON.stringify({ type: "start" }));
    expect(await client.next()).toMatchObject({ type: "ready", captureId: CAPTURE });
    expect(format).toEqual({ sampleRate: 16_000, channels: 1, encoding: "pcm16le" });

    handlers?.onPartial({ text: "临时文本", confidence: null });
    expect(await client.next()).toMatchObject({ type: "interim", text: "临时文本" });
    client.ws.send(Buffer.alloc(48_000));
    client.ws.send(JSON.stringify({ type: "stop" }));

    const stopping = await client.next();
    const final = await client.next();
    const completed = await client.next();
    expect(stopping).toMatchObject({ type: "stopping" });
    expect(final).toMatchObject({ type: "final", text: "最终文本", startMs: 0, endMs: 1_500 });
    expect(completed).toMatchObject({ type: "completed" });
    expect(trace.indexOf("persist-final")).toBeLessThan(trace.indexOf("finish-capture"));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ captureId: CAPTURE, durationSeconds: 2 });
    expect(usage[0]?.providerTaskId).toMatch(/^personal:capture-1:asr-provider-session-/);
    client.ws.close();
  });

  it("does not swallow an upstream error emitted while stopping", async () => {
    const provider: AsrProviderPort = {
      isConfigured: () => true,
      open: async handlers => ({
        pushAudio: () => undefined,
        commit: () => undefined,
        finish: async () => handlers.onError("ASR_PROVIDER_UNAVAILABLE", "upstream failed"),
        abort: () => undefined,
      }),
    };
    const client = await connect({ provider, repository: repositoryStub(), usage: usageMeter([]) });
    client.ws.send(JSON.stringify({ type: "start" }));
    expect(await client.next()).toMatchObject({ type: "ready" });
    client.ws.send(JSON.stringify({ type: "stop" }));
    expect(await client.next()).toMatchObject({ type: "stopping" });
    expect(await client.next()).toMatchObject({ type: "error", reason: "ASR_PROVIDER_UNAVAILABLE" });
    client.ws.close();
  });

  it("maps provider reasons outside the personal BoardX contract to provider unavailable", async () => {
    const provider: AsrProviderPort = {
      isConfigured: () => true,
      open: async handlers => ({
        ...sessionStub(() => undefined),
        finish: async () => handlers.onError("AUDIO_FORMAT_REJECTED", "upstream format detail"),
      }),
    };
    const client = await connect({ provider, repository: repositoryStub(), usage: usageMeter([]) });
    client.ws.send(JSON.stringify({ type: "start" }));
    expect(await client.next()).toMatchObject({ type: "ready" });
    client.ws.send(JSON.stringify({ type: "stop" }));
    expect(await client.next()).toMatchObject({ type: "stopping" });
    expect(await client.next()).toMatchObject({ type: "error", reason: "ASR_PROVIDER_UNAVAILABLE" });
    client.ws.close();
  });

  it("aborts a provider that finishes opening after the browser disconnects", async () => {
    let resolveOpen: ((session: ReturnType<typeof sessionStub>) => void) | undefined;
    let aborted = false;
    const provider: AsrProviderPort = {
      isConfigured: () => true,
      open: () => new Promise(resolve => { resolveOpen = resolve; }),
    };
    const client = await connect({ provider, repository: repositoryStub(), usage: usageMeter([]) });
    client.ws.send(JSON.stringify({ type: "start" }));
    client.ws.close();
    await once(client.ws, "close");
    resolveOpen?.(sessionStub(() => { aborted = true; }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
  });

  it("closes and aborts immediately when final persistence and cleanup both fail", async () => {
    let handlers: AsrSessionHandlers | undefined;
    let aborted = false;
    const provider: AsrProviderPort = {
      isConfigured: () => true,
      open: async nextHandlers => {
        handlers = nextHandlers;
        return sessionStub(() => { aborted = true; });
      },
    };
    const repository = repositoryStub({
      appendFinal: async () => { throw new Error("append failed"); },
      finishCapture: async () => { throw new Error("cleanup failed"); },
    });
    const client = await connect({ provider, repository, usage: usageMeter([]) });
    client.ws.send(JSON.stringify({ type: "start" }));
    expect(await client.next()).toMatchObject({ type: "ready" });

    handlers?.onFinal({ text: "不得发布", confidence: null });

    expect(await client.next()).toMatchObject({ type: "error", reason: "FINISH_TIMEOUT" });
    await once(client.ws, "close");
    expect(aborted).toBe(true);
  });

  it("aborts a finishing provider when the browser disconnects", async () => {
    let aborted = false;
    let resolveFinish: (() => void) | undefined;
    const provider: AsrProviderPort = {
      isConfigured: () => true,
      open: async () => ({
        ...sessionStub(() => { aborted = true; }),
        finish: () => new Promise<void>(resolve => { resolveFinish = resolve; }),
      }),
    };
    const client = await connect({ provider, repository: repositoryStub(), usage: usageMeter([]) });
    client.ws.send(JSON.stringify({ type: "start" }));
    expect(await client.next()).toMatchObject({ type: "ready" });
    client.ws.send(JSON.stringify({ type: "stop" }));
    expect(await client.next()).toMatchObject({ type: "stopping" });

    client.ws.close();
    await once(client.ws, "close");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
    resolveFinish?.();
  });
});

async function connect(input: {
  provider: AsrProviderPort;
  repository: PersonalTranscriptionRepository;
  usage: AsrUsageMeter;
}): Promise<{ ws: WebSocket; next: () => Promise<Record<string, unknown>> }> {
  const server = createServer();
  servers.push(server);
  let sequence = 0;
  attachPersonalRealtimeAsrGateway(server, {
    provider: input.provider,
    repository: input.repository,
    usage: input.usage,
    ids: { next: prefix => `${prefix}-${++sequence}` } satisfies IdGenerator,
    tickets: {
      issue: async ticket => ticket,
      consume: async () => ({
        ok: true,
        ticketHash: "hash",
        orgId: ORG,
        ownerUserId: OWNER,
        transcriptionId: TRANSCRIPTION,
        captureId: CAPTURE,
        expiresAtMs: Date.now() + 60_000,
      }),
    } satisfies RealtimeAsrTicketStore,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  const ticket = `${Buffer.from(ORG).toString("base64url")}.secret`;
  const client = new WebSocket(
    `ws://127.0.0.1:${address.port}/recording/realtime-asr/sessions/${TRANSCRIPTION}/captures/${CAPTURE}/stream?ticket=${ticket}`,
  );
  await once(client, "open");
  const frames: Record<string, unknown>[] = [];
  const waiters: Array<(frame: Record<string, unknown>) => void> = [];
  client.on("message", raw => {
    const frame = JSON.parse(String(raw)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(frame); else frames.push(frame);
  });
  return {
    ws: client,
    next: () => {
      const frame = frames.shift();
      if (frame) return Promise.resolve(frame);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for ASR frame")), 2_000);
        waiters.push(next => { clearTimeout(timer); resolve(next); });
      });
    },
  };
}

function usageMeter(events: AsrUsageEvent[]): AsrUsageMeter {
  return { record: async event => { events.push(event); return true; } };
}

function sessionStub(abort: () => void) {
  return {
    pushAudio: () => undefined,
    commit: () => undefined,
    finish: async () => undefined,
    abort,
  };
}

function repositoryStub(overrides: Partial<PersonalTranscriptionRepository> = {}): PersonalTranscriptionRepository {
  return {
    create: async () => { throw new Error("not used"); },
    listOwned: async () => ({ items: [], nextCursor: null }),
    readOwned: async () => undefined,
    hasActiveCapture: async () => false,
    replaceContent: async () => undefined,
    startCapture: async () => undefined,
    appendFinal: async () => undefined,
    finishCapture: async () => undefined,
    ...overrides,
  };
}
