import { createHash, randomUUID } from "node:crypto";

export interface IsolationOptions {
  isolationId?: string;
  worktreePath?: string;
}

export interface TestIsolationEnv extends Record<string, string> {
  WORKSPACEX_ISOLATION_SEED: string;
  WORKSPACEX_ISOLATION_ID: string;
  WORKSPACEX_DB: string;
  PGDATABASE: string;
  PGHOST: string;
  PGPORT: string;
  REDIS_PORT: string;
  REDIS_PREFIX: string;
  MINIO_PORT: string;
  MINIO_CONSOLE_PORT: string;
  WORKSPACEX_API_PORT: string;
  WORKSPACEX_WEB_PORT: string;
  COMPOSE_PROJECT_NAME: string;
  WORKSPACEX_DB_CONNECTION_BUDGET: string;
}

const ISOLATION_ENV_KEYS = [
  "WORKSPACEX_ISOLATION_SEED",
  "WORKSPACEX_ISOLATION_ID",
  "WORKSPACEX_DB",
  "PGDATABASE",
  "PGHOST",
  "PGPORT",
  "REDIS_PORT",
  "REDIS_PREFIX",
  "MINIO_PORT",
  "MINIO_CONSOLE_PORT",
  "WORKSPACEX_API_PORT",
  "WORKSPACEX_WEB_PORT",
  "COMPOSE_PROJECT_NAME",
  "WORKSPACEX_DB_CONNECTION_BUDGET",
] as const;

function inheritedIsolation(env: NodeJS.ProcessEnv): TestIsolationEnv | null {
  if (!ISOLATION_ENV_KEYS.every((key) => typeof env[key] === "string" && env[key]!.length > 0)) return null;
  return Object.fromEntries(ISOLATION_ENV_KEYS.map((key) => [key, env[key]!])) as TestIsolationEnv;
}

export interface DatabaseCapacity {
  maxConnections: number;
  reservedConnections: number;
  currentConnections: number;
  requiredConnections: number;
}

export function assertDatabaseCapacity(capacity: DatabaseCapacity): void {
  const available = capacity.maxConnections - capacity.reservedConnections - capacity.currentConnections;
  if (available < capacity.requiredConnections) {
    throw new Error(
      "PostgreSQL connection capacity insufficient: " +
      `max=${capacity.maxConnections} reserved=${capacity.reservedConnections} ` +
      `current=${capacity.currentConnections} available=${available} ` +
      `required=${capacity.requiredConnections}. Refusing to run; tests were not retried.`,
    );
  }
}

function safeId(value: string, hash: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${(cleaned || "run").slice(0, 27)}-${hash.slice(0, 12)}`;
}

function digest(worktreePath: string, isolationId: string): string {
  return createHash("sha256").update(`${worktreePath}\0${isolationId}`).digest("hex");
}

function portFrom(hash: string, offset: number): string {
  return String(offset + (Number.parseInt(hash.slice(0, 8), 16) % 5_000));
}

export function deriveTestIsolation(options: Required<IsolationOptions>): TestIsolationEnv {
  // Hash the caller's original id before making it safe for resource names. Otherwise
  // distinct ids such as `feature/74` and `feature-74` collapse onto the same resources.
  const hash = digest(options.worktreePath, options.isolationId);
  const isolationId = safeId(options.isolationId, hash);
  const resource = hash.slice(0, 20);
  const db = `wsx_${resource}`;

  return {
    WORKSPACEX_ISOLATION_SEED: options.isolationId,
    WORKSPACEX_ISOLATION_ID: isolationId,
    WORKSPACEX_DB: db,
    PGDATABASE: db,
    PGHOST: "127.0.0.1",
    PGPORT: portFrom(hash, 20_000),
    REDIS_PORT: portFrom(hash, 25_000),
    REDIS_PREFIX: `wsx:${isolationId}:`,
    MINIO_PORT: portFrom(hash, 30_000),
    MINIO_CONSOLE_PORT: portFrom(hash, 35_000),
    WORKSPACEX_API_PORT: portFrom(hash, 40_000),
    WORKSPACEX_WEB_PORT: portFrom(hash, 45_000),
    COMPOSE_PROJECT_NAME: `wsx-${resource}`,
    // Four Vitest workers, each allowed a five-connection application pool, plus
    // migrations/fixtures/monitoring headroom. The global setup enforces this budget.
    WORKSPACEX_DB_CONNECTION_BUDGET: "32",
  };
}

export function ensureTestIsolation(
  inherited: NodeJS.ProcessEnv,
  options: Pick<IsolationOptions, "worktreePath"> = {},
): TestIsolationEnv {
  const existing = inheritedIsolation(inherited);
  if (existing) return existing;
  const isolationId = inherited.WORKSPACEX_ISOLATION_SEED ?? inherited.WORKSPACEX_ISOLATION_ID ??
    `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  return deriveTestIsolation({
    isolationId,
    worktreePath: options.worktreePath ?? process.cwd(),
  });
}

// ── 端口预留（#468）────────────────────────────────────────────────────────
// 事故：`portFrom` 是 `base + parseInt(hash[0..8],16) % 5000` —— **确定性哈希取模**，
// 而且六个端口共用同一次抽签。后果有三层，一层比一层糟：
//   ① 槽位只有 5000 个，两个并发 run 撞上的概率不是零；
//   ② 一撞就是**六个端口一起撞**（共用同一个模值），不是撞一个；
//   ③ 最要命的是**重跑必然算出同一个端口** —— 同一个 worktree + 同一个 isolationId
//      再跑一次，还是那六个。所以"重试一次说不定就好了"在这里从来不成立。
// 2026-08-04 实测后果：同一个 SHA，push 触发的 run 绿、schedule 触发的红，错误是
// `failed to bind host port for 127.0.0.1:34646: address already in use`。栈名按 run
// 唯一化了，端口没有 —— 隔离在并发下是空转的。
//
// 修法：**向操作系统要端口，而不是猜端口**。从哈希推出的位置开始向上探测，逐个真的
// bind 一次；探到的端口**持续持有**直到调用方把栈起起来前才释放（`release()`），
// 这样两个并发 run 不可能选中同一个端口 —— 后者 bind 会失败，自然跳过。
// 起点再叠一个进程内随机偏移，两个同 id 的并发 run 也不会从同一个位置开始探。
import { createServer } from "node:net";

/** 每个服务的端口段宽度（与 portFrom 的 5000 一致）。探测不越出本段，避免踩到别的服务。 */
const PORT_BAND = 5_000;
const MAX_PROBES = 400;

const PORT_KEYS = [
  "PGPORT",
  "REDIS_PORT",
  "MINIO_PORT",
  "MINIO_CONSOLE_PORT",
  "WORKSPACEX_API_PORT",
  "WORKSPACEX_WEB_PORT",
] as const;

type PortKey = (typeof PORT_KEYS)[number];

const PORT_BASE: Record<PortKey, number> = {
  PGPORT: 20_000,
  REDIS_PORT: 25_000,
  MINIO_PORT: 30_000,
  MINIO_CONSOLE_PORT: 35_000,
  WORKSPACEX_API_PORT: 40_000,
  WORKSPACEX_WEB_PORT: 45_000,
};

function listenOn(port: number): Promise<ReturnType<typeof createServer> | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    // 只占 127.0.0.1：docker 的宿主端口映射也绑在 127.0.0.1（见 docker-compose.dev.yml），
    // 绑 0.0.0.0 会把"别人已经占了回环"这件事漏掉。
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

export interface PortReservation {
  ports: Record<PortKey, string>;
  /** 释放全部占位监听。调用方必须在真正起栈**之前**调它，且只调一次。 */
  release: () => Promise<void>;
}

/**
 * 为一次隔离实际预留六个空闲端口。
 *
 * 与旧 `portFrom` 的区别是**验证**：每个端口都真的 bind 过一次才算数，并且在
 * `release()` 之前一直被本进程持有 —— 并发的另一个 run 探到它会 bind 失败并跳过。
 * 探测越界（本段 5000 个位置里连 MAX_PROBES 个都占满）时**大声失败**，
 * 绝不退回"就用这个吧"—— 那正是本 issue 要根除的行为。
 */
export async function reserveIsolationPorts(seed: TestIsolationEnv): Promise<PortReservation> {
  const held: Array<ReturnType<typeof createServer>> = [];
  const ports = {} as Record<PortKey, string>;
  // 进程内随机起点偏移：两个 isolationId 相同的并发 run 不会从同一个位置开始探。
  const jitter = Math.floor(Math.random() * PORT_BAND);

  for (const key of PORT_KEYS) {
    const base = PORT_BASE[key];
    const derived = Number(seed[key]);
    const start = Number.isFinite(derived) ? derived : base;
    let chosen: number | null = null;
    for (let probe = 0; probe < MAX_PROBES; probe += 1) {
      const offset = (start - base + (probe === 0 ? 0 : jitter + probe)) % PORT_BAND;
      const candidate = base + offset;
      const server = await listenOn(candidate);
      if (server) {
        held.push(server);
        chosen = candidate;
        break;
      }
    }
    if (chosen === null) {
      await Promise.all(held.map((s) => new Promise<void>((r) => s.close(() => r()))));
      throw new Error(
        `[test-isolation] ${key} 段（${base}–${base + PORT_BAND - 1}）连续 ${MAX_PROBES} 个端口都占用中——` +
          "不猜一个端口硬上，先查是不是有栈没清干净（pnpm harness sweep-docker）。",
      );
    }
    ports[key] = String(chosen);
  }

  return {
    ports,
    release: async () => {
      await Promise.all(held.map((s) => new Promise<void>((r) => s.close(() => r()))));
      held.length = 0;
    },
  };
}

/**
 * 最外层入口：继承已有隔离，或推导 + **实际预留**端口。
 * 返回的 `release` 必须在起栈前调用；`reserved: false` 表示端口是继承来的，
 * 上层已经持有过，本层不该重复预留（嵌套 verify 的场景）。
 */
export async function ensureReservedTestIsolation(
  inherited: NodeJS.ProcessEnv,
  options: Pick<IsolationOptions, "worktreePath"> = {},
): Promise<{ env: TestIsolationEnv; release: () => Promise<void>; reserved: boolean }> {
  const existing = inheritedIsolation(inherited);
  if (existing) return { env: existing, release: async () => {}, reserved: false };
  const seed = ensureTestIsolation(inherited, options);
  const reservation = await reserveIsolationPorts(seed);
  return { env: { ...seed, ...reservation.ports }, release: reservation.release, reserved: true };
}
