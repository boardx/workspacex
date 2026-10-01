/**
 * 监督层的三条性质，都是「本地版第二次启动」这个最常见场景会撞到的。
 *
 * 之所以值得测：这三件事失败时的表现都**看起来像别的东西**——端口被占看起来像机器慢，
 * 子进程崩了看起来像还在启动，启动后崩了看起来像聊天框卡住。误诊的代价比故障本身大。
 */
import { execSync } from "node:child_process";
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

describe("startManaged", () => {
  it("stop() 连孙进程一起收，不只是直接子进程", async () => {
    // 形状同 uvicorn --workers / next 的 worker：子进程再起一个长活的进程。只杀直接子进程
    // 会留下孙进程占着端口。POSIX 靠进程组、Windows 靠 taskkill /T——同一条断言两边都判。
    // （原先用 `ps -g` 数组员，Windows 上没有 ps，那条测试在那里永远红、也永远证明不了什么。）
    const parent = [
      "const { spawn } = require('node:child_process');",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "console.log('GRANDCHILD ' + g.pid);",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const lines: string[] = [];
    const m = startManaged({ name: "tree", command: process.execPath, args: ["-e", parent], cwd: process.cwd(), env: {} }, (l) => lines.push(l));
    let gpid = 0;
    for (let i = 0; i < 100 && gpid === 0; i += 1) {
      const hit = lines.map((l) => /GRANDCHILD (\d+)/.exec(l)).find((x) => x !== null);
      if (hit) gpid = Number(hit[1]);
      else await new Promise((r) => setTimeout(r, 50));
    }
    const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    expect(gpid, "孙进程没报 pid").toBeGreaterThan(0);
    expect(alive(gpid), "正面对照：停之前孙进程活着").toBe(true);
    await m.stop();
    for (let i = 0; i < 30 && alive(gpid); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(alive(gpid)).toBe(false);
  });
});
