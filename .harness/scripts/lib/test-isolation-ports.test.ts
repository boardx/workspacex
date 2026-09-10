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
import { deriveTestIsolation, reserveIsolationPorts, PORT_BASE, PORT_BAND } from "./test-isolation";

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

const PORT_KEYS = [
  "PGPORT", "REDIS_PORT", "MINIO_PORT", "MINIO_CONSOLE_PORT",
  "WORKSPACEX_API_PORT", "WORKSPACEX_WEB_PORT", "SKILL_SANDBOX_PORT",
  "WORKSPACEX_MODEL_PROVIDER_PORT", "WORKSPACEX_DEEP_AGENT_PROVIDER_PORT",
  "WORKSPACEX_ASR_PROVIDER_PORT", "WORKSPACEX_VISION_PROVIDER_PORT",
  "WORKSPACEX_LOOPBACK_SANDBOX_PORT",
] as const;

/** 段起点，与 `test-isolation.ts` 的 `PORT_BASE` 一一对应（这里刻意写死一份对照，
 *  防止那张表被改动时本套反证跟着一起"自动正确"）。 */
const BANDS: Record<(typeof PORT_KEYS)[number], number> = {
  PGPORT: 20_000, REDIS_PORT: 21_000, MINIO_PORT: 22_000, MINIO_CONSOLE_PORT: 23_000,
  WORKSPACEX_API_PORT: 24_000, WORKSPACEX_WEB_PORT: 25_000, SKILL_SANDBOX_PORT: 26_000,
  WORKSPACEX_MODEL_PROVIDER_PORT: 27_000, WORKSPACEX_DEEP_AGENT_PROVIDER_PORT: 28_000,
  WORKSPACEX_ASR_PROVIDER_PORT: 29_000, WORKSPACEX_VISION_PROVIDER_PORT: 30_000,
  WORKSPACEX_LOOPBACK_SANDBOX_PORT: 31_000,
};
const BAND_WIDTH = 1_000;

// 对照副本与生产表必须一致——副本存在的意义是"生产表被改动时反证不会跟着自动正确"，
// 所以这里先把两者钉死，再由上面各条用副本做段内断言。


describe("#468 隔离端口必须是向 OS 预留的，不是哈希猜出来的", () => {
  it("反证：旧的推导本身是确定性的——同 id 同 worktree 必然算出同一组端口", () => {
    const a = deriveTestIsolation({ isolationId: "same-run", worktreePath: "/tmp/wt" });
    const b = deriveTestIsolation({ isolationId: "same-run", worktreePath: "/tmp/wt" });
    for (const key of PORT_KEYS) expect(b[key], key).toBe(a[key]);
    // 而且六个端口共用同一个模值——一撞就是六个一起撞
    const offsets = PORT_KEYS.map((key) => Number(a[key]) % BAND_WIDTH);
    expect(new Set(offsets).size, "全部端口的段内偏移完全相同").toBe(1);
  });

  it("预留出来的端口当场就是可用的（真的 bind 过）", async () => {
    const seed = deriveTestIsolation({ isolationId: "reserve-basic", worktreePath: "/tmp/wt" });
    const reservation = await reserveIsolationPorts(seed);
    const values = PORT_KEYS.map((key) => Number(reservation.ports[key]));
    expect(new Set(values).size, "每个角色一个互不相同的端口").toBe(PORT_KEYS.length);
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
    for (const key of PORT_KEYS) {
      const port = Number(reservation.ports[key]);
      expect(port, key).toBeGreaterThanOrEqual(BANDS[key]);
      expect(port, key).toBeLessThan(BANDS[key] + BAND_WIDTH);
    }
    await reservation.release();
  });
});

/**
 * 2026-09-10 —— run 34454123556 attempt 1（chat-read lane）：`next dev -p 47474`
 * 以 `EADDRINUSE :::47474` 秒死，**一条用例都没跑**却报 failure。那一趟
 * `pg=22474 redis=27474 sandbox=52474` ⇒ webPort=47474，而该 config 里没有任何
 * 第二个服务会绑 47474。抢走它的是内核的临时端口区（Linux 32768–60999、
 * macOS/Windows 49152–65535）：区内端口随时被出向连接临时占为源端口，占着那一刻
 * `listen()` 就是 EADDRINUSE。探测挡不住它——探测在起栈**之前**就 release 了。
 *
 * 下面两条是"这一类失效不可能再发生"的机械判据，不是复述。
 */
describe("隔离端口必须完全避开内核临时端口区", () => {
  const EPHEMERAL_LOW = 32_768; // Linux net.ipv4.ip_local_port_range 下界
  const MAC_EPHEMERAL_LOW = 49_152; // macOS / Windows 下界

  // ⚠ 这一条读的是**生产那张表**（`PORT_BASE`/`PORT_BAND`），不是本文件上面那份对照
  //   副本——读副本的话，把生产表改回 45_000 时它照样绿，就是一道空转的门。
  it("每个段（含段内全部候选位）都低于 Linux 与 macOS 两套临时端口区", () => {
    for (const key of Object.keys(PORT_BASE) as Array<keyof typeof PORT_BASE>) {
      const top = PORT_BASE[key] + PORT_BAND - 1;
      expect(top, `${key} 段顶 ${top} 落进了 Linux 临时端口区`).toBeLessThan(EPHEMERAL_LOW);
      expect(top, `${key} 段顶 ${top} 落进了 macOS 临时端口区`).toBeLessThan(MAC_EPHEMERAL_LOW);
    }
  });

  it("反证：旧布局确实落在临时端口区里（所以旧布局下 EADDRINUSE 是必然，不是运气）", () => {
    const legacy = { PGPORT: 20_000, REDIS_PORT: 25_000, MINIO_PORT: 30_000, MINIO_CONSOLE_PORT: 35_000, WORKSPACEX_API_PORT: 40_000, WORKSPACEX_WEB_PORT: 45_000, SKILL_SANDBOX_PORT: 50_000 };
    const exposed = Object.entries(legacy).filter(([, base]) => base + 5_000 - 1 >= EPHEMERAL_LOW);
    expect(exposed.map(([key]) => key)).toEqual([
      // MINIO 段（30000–34999）的上半截也伸进 32768 以上——旧布局里 7 个角色有 5 个暴露。
      "MINIO_PORT", "MINIO_CONSOLE_PORT", "WORKSPACEX_API_PORT", "WORKSPACEX_WEB_PORT", "SKILL_SANDBOX_PORT",
    ]);
  });
});

/**
 * 同一事实两处声明（本仓第 12 例）。旧的 `playwright.chat-read.config.ts` 用
 * `webPort + 5_000` 现算 model provider 的端口，而隔离外壳用 `portFrom(hash, 50_000)`
 * 现算 `SKILL_SANDBOX_PORT`——两者都是 `50000 + m`、共用同一次哈希抽签，**逐位相同**。
 */
describe("每个端口角色只声明一次，任何两个角色都不得算出同一个端口", () => {
  it("同一个隔离里，12 个角色的推导值两两不同", () => {
    for (const seedId of ["a", "b", "collision-probe", "x".repeat(40)]) {
      const env = deriveTestIsolation({ isolationId: seedId, worktreePath: "/tmp/wt" });
      const values = PORT_KEYS.map((key) => env[key]);
      expect(new Set(values).size, `${seedId}: ${values.join(",")}`).toBe(PORT_KEYS.length);
    }
  });

  it("反证：旧的 `webPort + 5_000` 与旧的 `SKILL_SANDBOX_PORT` 对任何哈希都相等", () => {
    for (const m of [0, 1, 445, 2_474, 4_999]) {
      expect(45_000 + m + 5_000).toBe(50_000 + m);
    }
  });

  it("两个沙箱是两个角色，端口不得相同（旧代码里它们只差大小写）", () => {
    const env = deriveTestIsolation({ isolationId: "two-sandboxes", worktreePath: "/tmp/wt" });
    expect(env.SKILL_SANDBOX_PORT).not.toBe(env.WORKSPACEX_LOOPBACK_SANDBOX_PORT);
  });
});

describe("对照副本与生产表一致", () => {
  it("BANDS/BAND_WIDTH 逐字对上 PORT_BASE/PORT_BAND", () => {
    expect(BAND_WIDTH).toBe(PORT_BAND);
    expect(BANDS).toEqual(PORT_BASE);
  });
});
