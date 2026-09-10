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
  SKILL_SANDBOX_PORT: string;
  WORKSPACEX_MODEL_PROVIDER_PORT: string;
  WORKSPACEX_DEEP_AGENT_PROVIDER_PORT: string;
  WORKSPACEX_ASR_PROVIDER_PORT: string;
  WORKSPACEX_VISION_PROVIDER_PORT: string;
  WORKSPACEX_LOOPBACK_SANDBOX_PORT: string;
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
  "SKILL_SANDBOX_PORT",
  "WORKSPACEX_MODEL_PROVIDER_PORT",
  "WORKSPACEX_DEEP_AGENT_PROVIDER_PORT",
  "WORKSPACEX_ASR_PROVIDER_PORT",
  "WORKSPACEX_VISION_PROVIDER_PORT",
  "WORKSPACEX_LOOPBACK_SANDBOX_PORT",
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

export interface IsolationGuardInput {
  /** 测试进程实际会连的库名（`migrationConfig().database`） */
  resolvedDatabase: string;
  /** 进程环境。隔离外壳会把 WORKSPACEX_* 一整套注进来 */
  env: NodeJS.ProcessEnv;
}

/**
 * 未隔离跑法**当场失败**（#538）。
 *
 * 事故：有人照着派工模板跑裸 turbo ——
 *   `TURBO_FORCE=1 pnpm turbo run test --filter=...`
 * 于是 34 条测试失败，全是幻影：它们打到了**共享的 `workspacex` 库**，彼此踩踏。
 * 唯一的线索是日志里一行 `db=workspacex`，而那行长得跟正常输出一模一样。
 * 咬掉了一整轮。包进隔离外壳后同一批 440/440 全过。
 *
 * 为什么这道检查必须在 **global setup 的第一行**：红在某条用例上，等于把一个
 * 「跑法错了」的清晰错误伪装成「某个业务断言挂了」——那正是那一轮被浪费掉的原因。
 * 在 setup 阶段抛，vitest 会直接报 setup 失败、一条用例都不跑，错误无处可藏。
 *
 * **没有豁免开关。** 一个能被环境变量关掉的隔离检查，第一次撞红时就会被关掉。
 */
export function assertIsolatedDatabase(input: IsolationGuardInput): void {
  const declared = input.env.WORKSPACEX_DB;
  const hint =
    "\n  正确跑法：pnpm exec tsx .harness/scripts/with-test-isolation.ts -- <你的命令>" +
    "\n  （裸跑 turbo/vitest 会连上共享库，产生彼此踩踏的幻影失败——" +
    "唯一线索只有一行 db=workspacex，看起来跟正常输出一模一样）";

  if (!declared) {
    throw new Error(
      `[test-isolation] 未在隔离外壳里运行：环境里没有 WORKSPACEX_DB，` +
        `本进程会连 "${input.resolvedDatabase}"。拒绝在共享库上跑测试。${hint}`,
    );
  }
  if (declared !== input.resolvedDatabase) {
    // 有隔离环境、但实际连的不是它——通常是别处覆盖了 PGDATABASE。
    // 这比完全没隔离更危险：日志看起来是隔离的，落点却不是。
    throw new Error(
      `[test-isolation] 隔离环境与实际连接不一致：WORKSPACEX_DB="${declared}"，` +
        `但本进程会连 "${input.resolvedDatabase}"。有人在中途覆盖了 PGDATABASE。${hint}`,
    );
  }
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

/**
 * 每个端口角色的段起点 —— **本仓唯一一份端口声明**。
 *
 * ## 为什么全部落在 20000–31999
 *
 * 2026-09-10 实测（`harness-verify` run 34454123556 attempt 1，chat-read lane）：
 * `next dev -p 47474` 以 `EADDRINUSE :::47474` 秒死，整趟**一条用例都没跑**却报 failure。
 * 那一趟 `[test-isolation] pg=22474 redis=27474 sandbox=52474` ⇒ webPort=47474，
 * 而这个 config 里**没有任何第二个服务**会去绑 47474（api=42474 / model=52474 /
 * deep-agent=53474 / loopback-sandbox=54474 / asr=57474 / vision=61474）。
 *
 * 抢走它的不是别的监听者，是**内核**：Linux 默认 `net.ipv4.ip_local_port_range`
 * = 32768–60999，macOS 是 49152–65535。这一段里的端口随时会被任何一条**出向连接**
 * （日志里紧挨着的那次 `docker compose pull`）临时占为源端口，而占着的那一刻
 * `listen()` 就是 EADDRINUSE。旧的探测（`reserveIsolationPorts`）挡不住它：探测在
 * 起栈**之前**就 `release()` 了，真正 bind 发生在几十秒之后，中间那段空窗正是内核
 * 的自由发挥区。所以这不是"再探一次"能修的——要修就得让端口**不在**那一段里。
 *
 * 20000–31999 同时避开 Linux（32768+）与 macOS/Windows（49152+）两套临时端口区。
 * 段宽从 5000 收到 1000：12 个角色 × 1000 = 12000 个位置，正好铺满这段；
 * 每段 1000 个候选位仍远多于 `MAX_PROBES`(400)，探测行为不变。
 *
 * ⚠ 新增端口角色**只许加在这张表里**。此前 `playwright.chat-read.config.ts` 与
 * `playwright.fullstack-smoke.config.ts` 各自用 `webPort + 5_000 / + 6_000 / + 7_000 /
 * + 10_000 / + 14_000 / + 15_000 / − 35_000` 现算五个替身端口——同一个角色两份声明、
 * 两套偏移量，而且一个都没有被 OS 探测过。后果不是理论上的：`webPort + 5_000` 与
 * `SKILL_SANDBOX_PORT`（旧 `portFrom(hash, 50_000)`）**逐位相同**（两者都是 `50000 + m`，
 * 共用同一次哈希抽签），chat-read 车道只是碰巧不起真沙箱才没炸；`e2e-up.sh` 那条
 * 真实模型链两个都起。本仓「同一事实不得声明在两处」那条纪律，这里是第 12 例。
 */
export const PORT_BAND = 1_000;

export const PORT_BASE = {
  PGPORT: 20_000,
  REDIS_PORT: 21_000,
  MINIO_PORT: 22_000,
  MINIO_CONSOLE_PORT: 23_000,
  WORKSPACEX_API_PORT: 24_000,
  WORKSPACEX_WEB_PORT: 25_000,
  /**
   * 真技能沙箱（`apps/skill-sandbox`，由 `e2e-up.sh` 起）。2026-09-06 之前它**不在**
   * 这张表里：`e2e-up.sh` 硬编码 8793，于是两个并行会话的沙箱必然撞端口，后起的那个
   * 以 EADDRINUSE 直接死掉——而 e2e-up.sh 不检查它起没起来，栈照常"就绪"。真实模型
   * lane 第一次真跑就栽在这里：沙箱没起来，模型于是答不出文件，断言"真的产出 PDF"
   * 红成一个看起来像产品缺陷的样子。
   */
  SKILL_SANDBOX_PORT: 26_000,
  /** 确定性模型上游替身（`apps/api/scripts/loopback-model-provider.ts`）。 */
  WORKSPACEX_MODEL_PROVIDER_PORT: 27_000,
  /** 确定性 deep-agent 上游替身（`loopback-deep-agent-provider.ts`）。 */
  WORKSPACEX_DEEP_AGENT_PROVIDER_PORT: 28_000,
  /** 确定性 ASR 上游替身（`loopback-asr-provider.ts`）。 */
  WORKSPACEX_ASR_PROVIDER_PORT: 29_000,
  /** 确定性视觉理解上游替身（`loopback-vision-provider.ts`）。 */
  WORKSPACEX_VISION_PROVIDER_PORT: 30_000,
  /**
   * 确定性技能沙箱替身（`loopback-skill-sandbox.ts`）。与上面的 `SKILL_SANDBOX_PORT`
   * 是**两个不同的进程**：那个是真沙箱，这个是回环替身。旧代码里它们一个叫
   * `SKILL_SANDBOX_PORT`、一个叫 `skillSandboxPort`，只差大小写，正是撞车的温床。
   */
  WORKSPACEX_LOOPBACK_SANDBOX_PORT: 31_000,
} as const;

const PORT_KEYS = Object.keys(PORT_BASE) as Array<keyof typeof PORT_BASE>;

type PortKey = (typeof PORT_KEYS)[number];

function portFrom(hash: string, offset: number): string {
  return String(offset + (Number.parseInt(hash.slice(0, 8), 16) % PORT_BAND));
}

/** 从哈希推出全部端口的起点（真正生效的值仍由 `reserveIsolationPorts` 探测确定）。 */
function derivedPorts(hash: string): Record<PortKey, string> {
  return Object.fromEntries(
    PORT_KEYS.map((key) => [key, portFrom(hash, PORT_BASE[key])]),
  ) as Record<PortKey, string>;
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
    ...derivedPorts(hash),
    REDIS_PREFIX: `wsx:${isolationId}:`,
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

// 段宽 / 段起点 / 角色清单都在文件上方那张 `PORT_BASE` 表里（唯一一份）。这里只用它。
const MAX_PROBES = 400;

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
 * 探测越界（本段 `PORT_BAND` 个位置里连 MAX_PROBES 个都占满）时**大声失败**，
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
