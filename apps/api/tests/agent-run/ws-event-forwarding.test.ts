/**
 * Phase 14 F03 (`streaming-transport` 契约束 UC-1 `subscribeRunEvents`) -- `WS
 * /agent-runs/:runId/events`.
 *
 * 只起一个裸 `http.Server` + `attachAgentRunEventsGateway`，用假的 `PrincipalResolverPort`/
 * `checkRunVisible` 驱动——同 `asr-draft-gateway.test.ts` 的既有先例：授权判定本身
 * （`resolveVisibility`/ACL 绑定/项目角色矩阵）已经在 identity/chat 束有自己的测试覆盖，
 * 这里只需要确认网关按判定结果做正确的事（放行/404/503），网关自己的职责——按序、
 * 不丢不重复地转发六类事件——才是这个文件要证明的。
 *
 * `RunEventBusPort` 用**真实**的 `InMemoryRunEventBus`（不是假的）：这正是生产环境里
 * `AGENT_RUN_EXECUTOR` 发布事件、这个网关订阅事件所共享的同一个实现（见
 * `kernel.module.ts` 该 provider 的注册注释），所以这条测试验证的是真实的转发机制，
 * 不是一个跟生产代码不同的替身。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { streamingTransport as ST } from "@repo/contracts";
import {
  attachAgentRunEventsGateway, type AgentRunEventsGatewayDeps, type RunVisibility,
} from "../../src/interface/ws/agent-run-events.gateway";
import { InMemoryRunEventBus } from "../../src/infrastructure/agent-run/in-memory-run-event-bus";
import type { PrincipalResolverPort } from "../../src/application/ports/principal-resolver.port";
import { toOrgId, type OrgId } from "../../src/domain/org-id";

const VALID_TOKEN = "valid-token";
const ORG: OrgId = toOrgId("org-ws-event-forwarding");
const USER = "user-1";
const RUN_ID = "run-1";

class FakePrincipalResolver implements PrincipalResolverPort {
  async resolve(headers: { authorization?: string }) {
    const token = headers.authorization?.replace(/^Bearer /, "");
    if (token !== VALID_TOKEN) return null;
    return { userId: USER, orgId: ORG } as never;
  }
}

/** 只有 `RUN_ID`、且必须是 `ORG` 这个租户，才判"可见"——同 `readAgentRun` 真实实现
 * 会给出的三个答案（visible/not_visible/unavailable），只是判断逻辑换成了固定表。 */
function fakeCheckRunVisible(): AgentRunEventsGatewayDeps["checkRunVisible"] {
  return async ({ orgId, runId }): Promise<RunVisibility> => {
    if (runId !== RUN_ID) return "not_visible";
    if (orgId !== ORG) return "not_visible";
    return "visible";
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

/**
 * `onMessage`, when given, is attached to the socket SYNCHRONOUSLY at construction --
 * before `await`ing this function's own promise. Replayed events (R3 步骤 4) can arrive
 * the instant the handshake completes, in the same tick `open` fires; attaching a
 * listener only after `await connect(...)` resolves would race that delivery and could
 * silently miss it. Every reconnect-style test below passes one; plain "connect" tests
 * that publish AFTER connecting don't need to.
 */
function connect(
  port: number, runId: string, protocols?: string[], query = "",
  onMessage?: (raw: unknown) => void,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent-runs/${runId}/events${query}`, protocols);
    if (onMessage) ws.on("message", (raw) => onMessage(JSON.parse(String(raw))));
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextFrame(ws: WebSocket): Promise<ST.KernelStreamEvent> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(String(raw))));
  });
}

describe("WS /agent-runs/:runId/events (Phase 14 F03)", () => {
  let server: Server;
  let port: number;
  let bus: InMemoryRunEventBus;

  beforeEach(async () => {
    server = createServer();
    bus = new InMemoryRunEventBus();
    attachAgentRunEventsGateway(server, {
      principals: new FakePrincipalResolver(),
      checkRunVisible: fakeCheckRunVisible(),
      events: bus,
    });
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses the handshake (no WS connection) when no bearer subprotocol is offered", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent-runs/${RUN_ID}/events`);
    const failure = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(failure).toBeDefined();
  });

  it("refuses the handshake when the bearer token does not resolve to a principal", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/agent-runs/${RUN_ID}/events`,
      ["bearer.not-a-real-token"],
    );
    const failure = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(failure).toBeDefined();
  });

  it("refuses the handshake for a run this principal cannot see -- same 404 discipline as GET /agent-runs/:runId", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/agent-runs/no-such-run/events`,
      [`bearer.${VALID_TOKEN}`],
    );
    const failure = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(failure).toBeDefined();
  });

  it("R12/I-1: forwards all six KernelStreamEvent kinds, in the order they were published, without loss", async () => {
    const ws = await connect(port, RUN_ID, [`bearer.${VALID_TOKEN}`]);

    const received: ST.KernelStreamEvent[] = [];
    const collectUntil = (count: number): Promise<void> => new Promise((resolve) => {
      ws.on("message", (raw) => {
        received.push(JSON.parse(String(raw)));
        if (received.length >= count) resolve();
      });
    });
    const done = collectUntil(6);

    // Published from a fresh subscribe (afterSeq -1) -- these are exactly the six kinds
    // `execute-run.ts`/`writeback.ts` produce over one real run's lifetime.
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "status_change", runId: RUN_ID, seq, status: "running", pausedBy: null,
      emittedAt: "2026-09-05T00:00:00.000Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "token_delta", runId: RUN_ID, seq, delta: "Hello", emittedAt: "2026-09-05T00:00:00.001Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "tool_call_start", runId: RUN_ID, seq, toolCallId: "tc-1", toolName: "search",
      args: { query: "weather" }, emittedAt: "2026-09-05T00:00:00.002Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "tool_call_end", runId: RUN_ID, seq, toolCallId: "tc-1", ok: true, result: { hits: 3 },
      emittedAt: "2026-09-05T00:00:00.003Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "checkpoint_saved", runId: RUN_ID, seq, checkpointId: `${RUN_ID}:3`,
      emittedAt: "2026-09-05T00:00:00.004Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "plan_update", runId: RUN_ID, seq,
      plan: { todos: [{ content: "step 1", status: "pending" }] },
      emittedAt: "2026-09-05T00:00:00.005Z",
    }));

    await done;
    expect(received.map((e) => e.type)).toEqual([
      "status_change", "token_delta", "tool_call_start", "tool_call_end",
      "checkpoint_saved", "plan_update",
    ]);
    // seq is monotonically increasing and unbroken -- I-4.
    expect(received.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    // Every frame on the wire is a valid `KernelStreamEvent` per the contract's own schema --
    // not a hand-shaped lookalike.
    for (const event of received) expect(() => ST.KernelStreamEvent.parse(event)).not.toThrow();

    ws.close();
  });

  it("forwards events published to a DIFFERENT run's bucket to nobody subscribed to this one", async () => {
    const ws = await connect(port, RUN_ID, [`bearer.${VALID_TOKEN}`]);
    const framePromise = nextFrame(ws);

    bus.publish(ORG, "some-other-run", (seq) => ({
      type: "token_delta", runId: "some-other-run", seq, delta: "not for you",
      emittedAt: "2026-09-05T00:00:00.000Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "token_delta", runId: RUN_ID, seq, delta: "for you", emittedAt: "2026-09-05T00:00:00.001Z",
    }));

    const frame = await framePromise;
    expect(frame.type).toBe("token_delta");
    expect((frame as { delta: string }).delta).toBe("for you");
    ws.close();
  });

  it("R3 步骤 4 / R4 E2: reconnect with lastKnownSeq replays exactly the events after it, then continues live -- no loss, no duplication", async () => {
    // Three events published BEFORE any client ever connects (as if this were a genuine
    // reconnect after a dropped WS, not a fresh subscribe).
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "token_delta", runId: RUN_ID, seq, delta: "a", emittedAt: "2026-09-05T00:00:00.000Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "token_delta", runId: RUN_ID, seq, delta: "b", emittedAt: "2026-09-05T00:00:00.001Z",
    }));
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "token_delta", runId: RUN_ID, seq, delta: "c", emittedAt: "2026-09-05T00:00:00.002Z",
    }));

    // Client already saw seq 0 ("a") before the drop -- reconnects asking for anything after it.
    // `onMessage` is wired at construction time (see `connect`'s own doc) so the replay,
    // which can arrive the instant the handshake completes, is never missed.
    const replayed: ST.KernelStreamEvent[] = [];
    let resolveCollected: (() => void) | undefined;
    const collected = new Promise<void>((resolve) => { resolveCollected = resolve; });
    const ws = await connect(port, RUN_ID, [`bearer.${VALID_TOKEN}`], "?lastKnownSeq=0", (raw) => {
      replayed.push(raw as ST.KernelStreamEvent);
      if (replayed.length >= 2) resolveCollected?.();
    });
    await collected;
    expect(replayed.map((e) => (e as { delta: string }).delta)).toEqual(["b", "c"]);
    expect(replayed.map((e) => e.seq)).toEqual([1, 2]);

    // And it keeps delivering new events live after the replay, still unbroken.
    const live = nextFrame(ws);
    bus.publish(ORG, RUN_ID, (seq) => ({
      type: "token_delta", runId: RUN_ID, seq, delta: "d", emittedAt: "2026-09-05T00:00:00.003Z",
    }));
    const liveFrame = await live;
    expect((liveFrame as { delta: string }).delta).toBe("d");
    expect(liveFrame.seq).toBe(3);
    ws.close();
  });
});
