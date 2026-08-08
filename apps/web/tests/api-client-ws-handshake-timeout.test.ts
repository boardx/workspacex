// api-client-ws-handshake-timeout.test.ts — #753 反证。
//
// 人类实测：devapp 上点击 composer 麦克风，浏览器拒绝权限后界面毫无反应。追查后发现
// 真正的根因跟权限拒绝无关——是部署侧反代没有给 `WS /chat/asr-draft`（#726）与
// `WS /recording/sessions/:id/asr-stream`（#466）开路由，握手请求打到 Next.js 前端，
// Upgrade 请求在那"断了"：连接既不 `open` 也不 `error`，永远半开着。
//
// `live-asr-draft.ts`/`live-asr.ts` 原来的握手逻辑只等 `open`/`error` 两个事件——
// 这种"安静挂起"的失败模式两个事件都不会触发，`await` 永久 pending，界面上
// 什么都不会发生，跟"点了没反应"一模一样。这里钉住共享的 `waitForSocketOpen`
// helper：握手必须有超时兜底，且超时后要把半开的 socket 关掉。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_HANDSHAKE_TIMEOUT_MS, waitForSocketOpen } from "@/lib/api-client";

/** 只实现 `waitForSocketOpen` 需要的那一小片 WebSocket 接口。 */
class HangingSocket {
  readonly closeCalls: number[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(): void {
    // 未使用——`{ once: true }` 由调用方自己不重复触发来模拟，测试里不需要真的摘监听。
  }

  close(): void {
    this.closeCalls.push(Date.now());
  }

  /** 测试主动驱动：真实浏览器场景里这两个事件永远不会来，这里保留手段但故意不调用它们。 */
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe("#753 waitForSocketOpen —— 握手阶段必须有超时兜底，不能只等 open/error", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("反代把 WS 路由错时连接安静挂起（不 open 不 error）——必须在超时后拒绝，而不是永久 pending", async () => {
    const socket = new HangingSocket();
    const onHandshakeFailed = vi.fn(() => new Error("handshake_failed"));

    const promise = waitForSocketOpen(socket as unknown as WebSocket, onHandshakeFailed, 5_000);

    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled, "超时之前不该提前失败——真实的慢握手不该被误判").toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toThrow("ws_handshake_timeout");
    expect(socket.closeCalls.length, "超时后必须把半开的 socket 关掉，不留一条没人再理会的连接").toBe(1);
    expect(onHandshakeFailed, "超时走的是独立的失败原因，不该借用 error 事件那条判定").not.toHaveBeenCalled();
  });

  it("在超时之前正常 open：照常 resolve，不受超时定时器影响", async () => {
    const socket = new HangingSocket();
    const promise = waitForSocketOpen(socket as unknown as WebSocket, () => new Error("handshake_failed"), 5_000);

    await vi.advanceTimersByTimeAsync(100);
    socket.emit("open");

    await expect(promise).resolves.toBeUndefined();
    expect(socket.closeCalls.length, "正常打开不该被顺手关掉").toBe(0);
  });

  it("浏览器真的报出 error 事件（有信息量的握手拒绝）：照常按 error 分支拒绝，不用等到超时", async () => {
    const socket = new HangingSocket();
    const promise = waitForSocketOpen(socket as unknown as WebSocket, () => new Error("handshake_failed"), 5_000);

    await vi.advanceTimersByTimeAsync(100);
    socket.emit("error");

    await expect(promise).rejects.toThrow("handshake_failed");
  });

  it("缺省超时是一个有限的正数——不给显式超时时也不会无限等下去", () => {
    expect(WS_HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(WS_HANDSHAKE_TIMEOUT_MS)).toBe(true);
  });
});
