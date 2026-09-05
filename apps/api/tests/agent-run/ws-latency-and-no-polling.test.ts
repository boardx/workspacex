/**
 * Phase 14 F03 (`streaming-transport` 契约束, R9 / I-6, and R7's polling-contract cleanup).
 *
 * Two things this feature's delivery contract asks for, verified here:
 *
 *  1. **I-6 延迟上限** -- 事件产生到前端收到的端到端延迟 < 500ms（R9）。Injects a
 *     timestamped event through the REAL production path (a real `InMemoryRunEventBus`,
 *     the SAME implementation `AGENT_RUN_EXECUTOR` publishes onto in production, and the
 *     REAL `attachAgentRunEventsGateway`) and measures wall-clock time from `publish()`
 *     to the client's `message` event.
 *
 *  2. **轮询契约的书面声明已更新，不再声称"没有推流变体"** -- `wave2-runtime.ts`'s
 *     `operations` head comment used to read "there is no SSE variant in this slice";
 *     that sentence became false the moment this feature shipped a real push transport
 *     (`streaming-transport.ts`'s `subscribeRunEvents`), and a stale claim like that is
 *     exactly the "静态痕迹 ≠ 动态事实" failure mode this repo has been burned by before
 *     (`.harness/instructions/static-trace-vs-live-fact.md`). This test statically asserts
 *     the stale claim is gone and the real replacement is named.
 *
 *     ⚠ 诚实的范围声明：这条测试**不**断言 `agui-bridge.ts`（CopilotKit AG-UI SSE 桥）自己
 *     内部那条 `sleep()`-based 轮询循环（`pollAguiRunToOutcome`）已被物理删除——那是一条
 *     独立于本 feature 新增 WS 端点的既有生产路径，13 个既有测试文件（含
 *     `poll-budget-covers-deep-agent-timeout.test.ts` 记录的两次真实 2026-08-29 devapp
 *     故障回归用例）直接依赖它现在的样子；把它换成事件驱动需要 F04（前端订阅改造）
 *     同一轮一起做（R9："一次性切换,不保留旧轮询兼容层"——半吊子切换本身就违反这条），
 *     不是这个 WS 端点 feature 单独能安全完成的最小实现。这段注释就是这件事的书面
 *     记录，不是把它藏起来。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const ORG: OrgId = toOrgId("org-ws-latency");
const USER = "user-1";
const RUN_ID = "run-latency-1";
/** R9's own number, not re-derived -- the requirement IS 500ms, this is not a looser
 * "close enough" budget invented for the test. */
const LATENCY_BUDGET_MS = 500;

class FakePrincipalResolver implements PrincipalResolverPort {
  async resolve(headers: { authorization?: string }) {
    const token = headers.authorization?.replace(/^Bearer /, "");
    if (token !== VALID_TOKEN) return null;
    return { userId: USER, orgId: ORG } as never;
  }
}

function alwaysVisible(): AgentRunEventsGatewayDeps["checkRunVisible"] {
  return async (): Promise<RunVisibility> => "visible";
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

function connect(port: number, runId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent-runs/${runId}/events`, [`bearer.${VALID_TOKEN}`]);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

describe("Phase 14 F03 -- WS event latency (I-6) and the retired polling contract (R7)", () => {
  let server: Server;
  let port: number;
  let bus: InMemoryRunEventBus;

  beforeEach(async () => {
    server = createServer();
    bus = new InMemoryRunEventBus();
    attachAgentRunEventsGateway(server, {
      principals: new FakePrincipalResolver(),
      checkRunVisible: alwaysVisible(),
      events: bus,
    });
    port = await listen(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("I-6: wall-clock from immediately-before-publish to client message receipt is < 500ms", async () => {
    const ws = await connect(port, RUN_ID);

    const before = Date.now();
    const elapsedMs = await new Promise<number>((resolve) => {
      ws.once("message", () => resolve(Date.now() - before));
      bus.publish(ORG, RUN_ID, (seq) => ({
        type: "token_delta", runId: RUN_ID, seq, delta: "timed",
        emittedAt: new Date(before).toISOString(),
      }));
    });
    expect(elapsedMs).toBeLessThan(LATENCY_BUDGET_MS);
    ws.close();
  });

  it("I-6 holds across all six event kinds, not just token_delta", async () => {
    const ws = await connect(port, RUN_ID);
    const events: Array<(seq: number) => ST.KernelStreamEvent> = [
      (seq) => ({ type: "status_change", runId: RUN_ID, seq, status: "running", pausedBy: null, emittedAt: new Date().toISOString() }),
      (seq) => ({ type: "tool_call_start", runId: RUN_ID, seq, toolCallId: "tc-1", toolName: "x", args: {}, emittedAt: new Date().toISOString() }),
      (seq) => ({ type: "tool_call_end", runId: RUN_ID, seq, toolCallId: "tc-1", ok: true, result: null, emittedAt: new Date().toISOString() }),
      (seq) => ({ type: "checkpoint_saved", runId: RUN_ID, seq, checkpointId: "cp-1", emittedAt: new Date().toISOString() }),
      (seq) => ({ type: "plan_update", runId: RUN_ID, seq, plan: { todos: [{ content: "t", status: "pending" }] }, emittedAt: new Date().toISOString() }),
    ];
    for (const build of events) {
      const before = Date.now();
      const elapsedMs = await new Promise<number>((resolve) => {
        ws.once("message", () => resolve(Date.now() - before));
        bus.publish(ORG, RUN_ID, build);
      });
      expect(elapsedMs).toBeLessThan(LATENCY_BUDGET_MS);
    }
    ws.close();
  });

  it("R7: wave2-runtime.ts no longer claims there is no push/streaming variant, and names the real replacement", () => {
    const contractPath = fileURLToPath(
      new URL("../../../../packages/contracts/src/wave2-runtime.ts", import.meta.url),
    );
    const source = readFileSync(contractPath, "utf8");
    expect(source).not.toContain("There is no SSE variant in this slice");
    expect(source).toContain("subscribeRunEvents");
  });

  it("R7: the real push transport this file's own header names actually exists with the WS method (not a dangling reference)", () => {
    expect(ST.operations.subscribeRunEvents.method).toBe("WS");
    expect(ST.operations.subscribeRunEvents.path).toBe("/agent-runs/:runId/events");
  });
});
