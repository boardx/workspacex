/**
 * agui-bridge 系列反复 30s 超时的两条机械门（2026-09-09）。
 *
 * 这一族在 CI 上一夜红六次、每次都被当抖动重跑掉，真根因不是争用而是**确定性挂起**，
 * 由两个各自独立、叠在一起才致命的缺陷组成：
 *
 *   ① 中继（`agui-bridge.ts` / `stream-run.ts`）的预算是 900s，比测试自己 30s 的
 *      上限长 30 倍，且**没有任何调节口**。run 一卡住，测试只能报一条什么都不说的
 *      `Test timed out in 30000ms`。
 *   ② vitest 的用例超时不掐连接，于是那条还开着的 socket 让 `afterAll` 里的
 *      `close()` 一直等，再报 `Hook timed out in 120000ms`——**整个文件**连同其余
 *      全部通过的用例一起判红。这就是「重跑就绿」的来源。
 *
 * 下面两组断言分别钉住 ① 的调节口与 ② 的确定性收尾。两条都是纯内存、无 DB，跑得起。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_RUN_MAX_POLLS, DEFAULT_RUN_POLL_INTERVAL_MS, RUN_RELAY_MAX_WAIT_MS_ENV, resolveRunMaxPolls,
} from "../../src/application/agent-run/poll-budget";
import { closeHttpServerDeterministically } from "../support/close-app";

describe("relay poll budget is overridable without moving the production default", () => {
  const original = process.env[RUN_RELAY_MAX_WAIT_MS_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[RUN_RELAY_MAX_WAIT_MS_ENV];
    else process.env[RUN_RELAY_MAX_WAIT_MS_ENV] = original;
  });

  it("unset -> the unchanged 900s production budget", () => {
    delete process.env[RUN_RELAY_MAX_WAIT_MS_ENV];
    expect(resolveRunMaxPolls(DEFAULT_RUN_POLL_INTERVAL_MS)).toBe(DEFAULT_RUN_MAX_POLLS);
  });

  it("set -> narrows to that wall-clock budget, in polls", () => {
    process.env[RUN_RELAY_MAX_WAIT_MS_ENV] = "20000";
    expect(resolveRunMaxPolls(DEFAULT_RUN_POLL_INTERVAL_MS)).toBe(20_000 / DEFAULT_RUN_POLL_INTERVAL_MS);
  });

  it("a typo'd value fails OPEN to the default -- never to zero polls (which would make " +
     "every run time out instantly, a far worse failure than the one being fixed)", () => {
    for (const bad of ["", "   ", "abc", "0", "-1", "NaN"]) {
      process.env[RUN_RELAY_MAX_WAIT_MS_ENV] = bad;
      expect(resolveRunMaxPolls(DEFAULT_RUN_POLL_INTERVAL_MS)).toBe(DEFAULT_RUN_MAX_POLLS);
    }
  });
});

describe("teardown does not outsource its liveness to a stalled peer", () => {
  let server: Server | undefined;
  afterEach(() => { server?.closeAllConnections(); server?.close(); server = undefined; });

  it("closes a server that still has an in-flight request nobody will ever answer", async () => {
    // 反证的核心：一条「收下请求就再也不回」的连接。裸 `server.close(cb)` 的回调
    // 在这种情形下永远不来——这正是 `Hook timed out in 120000ms` 的机制。
    server = createServer(() => { /* never responds, never ends the response */ });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const inFlight = fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
    // 等这条请求真的到达服务端并被挂住，否则「关得掉」证明不了任何事。
    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        server!.getConnections((_e, count) => { if (count > 0) { clearInterval(wait); resolve(); } });
      }, 10);
    });

    const started = Date.now();
    await closeHttpServerDeterministically(server);
    const elapsedMs = Date.now() - started;
    server = undefined;
    await inFlight;

    // 裸 close 在这里会挂到 hookTimeout（120s）。确定性收尾必须以毫秒计。
    expect(elapsedMs).toBeLessThan(2_000);
  }, 30_000);
});
