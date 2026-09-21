/**
 * 监督层的三条性质，都是「本地版第二次启动」这个最常见场景会撞到的。
 *
 * 之所以值得测：这三件事失败时的表现都**看起来像别的东西**——端口被占看起来像机器慢，
 * 子进程崩了看起来像还在启动，启动后崩了看起来像聊天框卡住。误诊的代价比故障本身大。
 */
import net from "node:net";
import { describe, expect, it } from "vitest";
import { portInUse, startManaged, waitForHttpOrExit } from "../src/processes";

async function listening(port: number): Promise<net.Server> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return server;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

describe("portInUse", () => {
  it("tells a busy loopback port from a free one", async () => {
    const port = await freePort();
    expect(await portInUse(port)).toBe(false);
    const server = await listening(port);
    try {
      expect(await portInUse(port)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("waitForHttpOrExit", () => {
  it("fails as soon as the child dies, and says what it printed", async () => {
    const port = await freePort();
    const managed = startManaged({
      name: "doomed",
      command: process.execPath,
      args: ["-e", 'console.error("配置缺失：KERNEL_MODEL_BASE_URL"); process.exit(3);'],
      cwd: process.cwd(),
      env: {},
    }, () => {});

    const started = Date.now();
    // 预算给到 60 秒；真死掉的话不该等满
    await expect(waitForHttpOrExit(`http://127.0.0.1:${port}/healthz`, { timeoutMs: 60_000 }, managed))
      .rejects.toThrow(/doomed exited \(code 3\)/);
    expect(Date.now() - started).toBeLessThan(15_000);

    await expect(waitForHttpOrExit(`http://127.0.0.1:${port}/healthz`, { timeoutMs: 1_000 }, managed))
      .rejects.toThrow(/KERNEL_MODEL_BASE_URL/);
  }, 30_000);

  it("returns when the child does come up", async () => {
    const port = await freePort();
    const managed = startManaged({
      name: "ok",
      command: process.execPath,
      args: ["-e", `require("node:http").createServer((_q,s)=>{s.end("ok")}).listen(${port},"127.0.0.1")`],
      cwd: process.cwd(),
      env: {},
    }, () => {});
    try {
      await waitForHttpOrExit(`http://127.0.0.1:${port}/`, { timeoutMs: 20_000 }, managed);
    } finally {
      await managed.stop();
    }
  }, 30_000);
});
