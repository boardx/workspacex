/**
 * `DebugRecorder` —— `DebugTracePort` 的进程内实现：环形缓冲 + 后台批量落库（issue #3082）。
 *
 * ## 为什么是「缓冲 + 批量」而不是每条 INSERT
 *
 * `error_logs` 每条一 INSERT 是对的——它记的是低频的「炸了」。这里记的是**每个请求**，
 * 一次 INSERT 一条会把请求流水变成一倍的 DB 写压力（5 连接的池）。批量之后一次 flush 是
 * 一条多行 INSERT，量级差 50 倍。
 *
 * ## 为什么 DB 挂了也要继续攒
 *
 * 最需要诊断数据的时刻恰恰是基础设施在出事的时刻。DB 写失败 ⇒ 记一次失败、事件留在
 * 缓冲（满了丢最旧）、下一轮再试；同时 `recent()` 永远能从内存读最近 N 条——这就是
 * `GET /system/debug/events?source=memory` 的来源。
 *
 * ## 不依赖 timer 的存在也能工作
 *
 * `record()` 攒够 `batchSize` 就触发一次 flush；此外 `start()` 挂一个 `flushIntervalMs`
 * 的 interval（`unref`，不拖住进程退出）。测试里不 `start()`，用 `flush()` 手动驱动。
 */
import type {
  DebugEvent,
  DebugEventInput,
  DebugEventPage,
  DebugEventQuery,
  DebugEventRow,
  DebugEventStore,
  DebugRecorderStats,
  DebugTracePort,
} from "../ports/debug-trace.port";
import { toDebugEvent } from "../ports/debug-trace.port";
import { redactErrorMessage } from "../ports/error-log.port";

export interface DebugRecorderOptions {
  /** 关掉 = `record()` 直接丢弃，读口仍可用（返回空）。 */
  readonly enabled?: boolean;
  /** 内存里最多攒多少条（含还没落库的 + 已落库但留作 `recent()` 的）。 */
  readonly capacity?: number;
  /** 攒够这么多未落库事件就立刻 flush。 */
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly now?: () => string;
  readonly onFlushError?: (err: unknown) => void;
}

interface Buffered {
  readonly seq: number;
  readonly event: DebugEvent;
  persisted: boolean;
}

export class DebugRecorder implements DebugTracePort {
  private readonly enabled: boolean;
  private readonly capacity: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly now: () => string;
  private readonly onFlushError: (err: unknown) => void;

  private ring: Buffered[] = [];
  private seq = 0;
  private flushed = 0;
  private dropped = 0;
  private flushFailures = 0;
  private lastFlushError: string | null = null;
  private lastFlushAt: string | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly store: DebugEventStore, opts: DebugRecorderOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.capacity = Math.max(1, opts.capacity ?? 5_000);
    this.batchSize = Math.max(1, opts.batchSize ?? 100);
    this.flushIntervalMs = Math.max(50, opts.flushIntervalMs ?? 2_000);
    this.now = opts.now ?? (() => new Date().toISOString());
    this.onFlushError = opts.onFlushError ?? (() => undefined);
  }

  record(input: DebugEventInput): void {
    if (!this.enabled) return;
    let event: DebugEvent;
    try {
      event = toDebugEvent(input, this.now());
    } catch {
      // 脱敏本身炸了（理论上不会）——宁可丢这一条，也不让记录器把调用方带下水。
      this.dropped += 1;
      return;
    }
    this.ring.push({ seq: ++this.seq, event, persisted: false });
    if (this.ring.length > this.capacity) {
      const evicted = this.ring.splice(0, this.ring.length - this.capacity);
      this.dropped += evicted.filter((b) => !b.persisted).length;
    }
    if (this.pendingCount() >= this.batchSize) void this.flush();
  }

  private pendingCount(): number {
    let n = 0;
    for (const b of this.ring) if (!b.persisted) n += 1;
    return n;
  }

  /** 幂等：同一时刻只有一个 flush 在飞；并发调用共用同一个 promise。 */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const pending = this.ring.filter((b) => !b.persisted);
    if (pending.length === 0) return Promise.resolve();
    this.inFlight = (async () => {
      try {
        await this.store.insertBatch(pending.map((b) => b.event));
        for (const b of pending) b.persisted = true;
        this.flushed += pending.length;
        this.lastFlushAt = this.now();
      } catch (err) {
        this.flushFailures += 1;
        this.lastFlushError = redactErrorMessage(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        this.onFlushError(err);
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Nest 关机钩子（按方法名识别，不需要 import Nest）：把缓冲里的事件写完再退出。 */
  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  query(q: DebugEventQuery): Promise<DebugEventPage> {
    return this.store.query(q);
  }

  getTrace(traceId: string): Promise<readonly DebugEventRow[]> {
    return this.store.getTrace(traceId);
  }

  recent(q: DebugEventQuery): DebugEventPage {
    const before = q.beforeId === null ? Number.POSITIVE_INFINITY : Number(q.beforeId);
    const needle = q.q?.toLowerCase();
    const matches: DebugEventRow[] = [];
    for (let i = this.ring.length - 1; i >= 0 && matches.length <= q.limit; i -= 1) {
      const b = this.ring[i]!;
      const e = b.event;
      if (!(b.seq < before)) continue;
      if (q.traceId !== undefined && e.traceId !== q.traceId) continue;
      if (q.kind !== undefined && e.kind !== q.kind && !e.kind.startsWith(`${q.kind}.`)) continue;
      if (q.level !== undefined && e.level !== q.level) continue;
      if (q.userId !== undefined && e.userId !== q.userId) continue;
      if (q.since !== undefined && e.createdAt < q.since) continue;
      if (q.until !== undefined && e.createdAt > q.until) continue;
      if (needle !== undefined && !e.msg.toLowerCase().includes(needle)) continue;
      matches.push({ id: `mem-${b.seq}`, ...e });
    }
    const hasMore = matches.length > q.limit;
    return { items: hasMore ? matches.slice(0, q.limit) : matches, hasMore };
  }

  stats(): DebugRecorderStats {
    return {
      enabled: this.enabled,
      buffered: this.pendingCount(),
      flushed: this.flushed,
      dropped: this.dropped,
      flushFailures: this.flushFailures,
      lastFlushError: this.lastFlushError,
      lastFlushAt: this.lastFlushAt,
    };
  }
}

/** 环境变量 → 选项；集中在一处，`kernel.module.ts` 只管调用。 */
export function debugRecorderOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): DebugRecorderOptions {
  const num = (k: string): number | undefined => {
    const v = env[k];
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    enabled: env.DEBUG_TRACE_ENABLED !== "0",
    capacity: num("DEBUG_TRACE_CAPACITY"),
    batchSize: num("DEBUG_TRACE_BATCH_SIZE"),
    flushIntervalMs: num("DEBUG_TRACE_FLUSH_INTERVAL_MS"),
  };
}
