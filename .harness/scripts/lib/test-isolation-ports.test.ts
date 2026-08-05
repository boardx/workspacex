// test-isolation-ports.test.ts — #468 的反证。
//
// 被修的东西：`portFrom` 是 `base + parseInt(hash[0..8],16) % 5000`——确定性哈希取模，
// 六个端口共用同一次抽签。所以（a）同一个 isolationId 重跑必然算出同一组端口，
// （b）两个并发 run 撞上时是六个一起撞，（c）"重试一次"永远救不回来。
//
// 下面第一条用**旧算法本身**把这个性质证出来（它现在仍然是探测的起点，所以还在），
// 其余各条证明新的预留路径不再有这个性质。
import { createServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import { deriveTestIsolation, reserveIsolationPorts } from "./test-isolation";

function listen(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const PORT_KEYS = ["PGPORT", "REDIS_PORT", "MINIO_PORT", "MINIO_CONSOLE_PORT", "WORKSPACEX_API_PORT", "WORKSPACEX_WEB_PORT"] as const;

describe("#468 隔离端口必须是向 OS 预留的，不是哈希猜出来的", () => {
  it("反证：旧的推导本身是确定性的——同 id 同 worktree 必然算出同一组端口", () => {
    const a = deriveTestIsolation({ isolationId: "same-run", worktreePath: "/tmp/wt" });
    const b = deriveTestIsolation({ isolationId: "same-run", worktreePath: "/tmp/wt" });
    for (const key of PORT_KEYS) expect(b[key], key).toBe(a[key]);
    // 而且六个端口共用同一个模值——一撞就是六个一起撞
    const offsets = PORT_KEYS.map((key) => Number(a[key]) % 5_000);
    expect(new Set(offsets).size, "六个端口的段内偏移完全相同").toBe(1);
  });

  it("预留出来的端口当场就是可用的（真的 bind 过）", async () => {
    const seed = deriveTestIsolation({ isolationId: "reserve-basic", worktreePath: "/tmp/wt" });
    const reservation = await reserveIsolationPorts(seed);
    const values = PORT_KEYS.map((key) => Number(reservation.ports[key]));
    expect(new Set(values).size, "六个端口互不相同").toBe(6);
    await reservation.release();
    // 释放后应当能被别人绑上——证明刚才那些确实是我们持有的真实监听
    const servers = await Promise.all(values.map((port) => listen(port)));
    expect(servers.every(Boolean), "释放后端口应当可再次绑定").toBe(true);
    await Promise.all(servers.filter(Boolean).map((s) => close(s!)));
  });

  it("核心反证：两个 isolationId 完全相同的并发预留，拿到的端口不得重叠", async () => {
    // 这正是 CI 上的场景：同一 SHA、同一 worktree 路径、两条 run 同时起栈。
    // 旧实现下两边算出的六个端口完全一样（见第一条），必然 EADDRINUSE。
    const seed = deriveTestIsolation({ isolationId: "concurrent-same-id", worktreePath: "/tmp/wt" });
    const first = await reserveIsolationPorts(seed);
    const second = await reserveIsolationPorts(seed); // 第一份还没 release，模拟并发
    try {
      const a = new Set(PORT_KEYS.map((key) => first.ports[key]));
      const b = PORT_KEYS.map((key) => second.ports[key]);
      const overlap = b.filter((port) => a.has(port));
      expect(overlap, `并发预留拿到了相同端口：${overlap.join(", ")}`).toEqual([]);
    } finally {
      await first.release();
      await second.release();
    }
  });

  it("起点被占时向上跳过，而不是硬用那个被占的端口", async () => {
    const seed = deriveTestIsolation({ isolationId: "occupied-start", worktreePath: "/tmp/wt" });
    const blocked = Number(seed.PGPORT);
    const squatter = await listen(blocked);
    expect(squatter, "测试前置：起点端口必须能被占住").not.toBeNull();
    try {
      const reservation = await reserveIsolationPorts(seed);
      expect(Number(reservation.ports.PGPORT)).not.toBe(blocked);
      await reservation.release();
    } finally {
      await close(squatter!);
    }
  });

  it("预留结果仍落在各服务自己的端口段内，不会串到别的服务", async () => {
    const seed = deriveTestIsolation({ isolationId: "bands", worktreePath: "/tmp/wt" });
    const reservation = await reserveIsolationPorts(seed);
    const bands: Record<string, number> = {
      PGPORT: 20_000, REDIS_PORT: 25_000, MINIO_PORT: 30_000,
      MINIO_CONSOLE_PORT: 35_000, WORKSPACEX_API_PORT: 40_000, WORKSPACEX_WEB_PORT: 45_000,
    };
    for (const key of PORT_KEYS) {
      const port = Number(reservation.ports[key]);
      expect(port, key).toBeGreaterThanOrEqual(bands[key]!);
      expect(port, key).toBeLessThan(bands[key]! + 5_000);
    }
    await reservation.release();
  });
});
