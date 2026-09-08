/**
 * `DebugTracePort` —— 后台 debug recorder 的应用层端口（issue #3082）。
 *
 * ## 为什么要有它（#2873 复盘）
 *
 * deep-agent 假死那两小时，问题不是「没人会查」，是**没有东西可查**：`error_logs` 只在
 * 异常真的抛出来时才有一行，而一个挂着不返回的请求什么都不抛；stdout 日志在 journald
 * 里，runner 用户读不到。于是定位只能靠人类上 VM。这个端口把「请求流水 / 卡住的请求 /
 * 未处理异常 / 业务显式打点」统一记成结构化事件、落到一张 agent 能查的表里。
 *
 * ## 三条纪律（与 `error-log.port.ts` 相同，且更严）
 *
 * 1. **记录永远不能拖慢或搞坏业务路径**：`record()` 同步入内存环形缓冲即返回，落库由
 *    后台批量完成；缓冲满了丢最旧的，DB 挂了记一次失败继续攒——**任何情况下不抛、不 await**。
 * 2. **写进去的都是脱敏过的**：`redactDebugData` 在入缓冲前跑一遍，密钥/authorization/
 *    cookie 之类的键整键丢弃，字符串值走 `redactErrorMessage` 的同一套正则与截断。
 * 3. **读回来的只给平台运营准入**：`query()`/`getTrace()` 走 `app_diag_ro` 凭据，与
 *    `error_logs` 同一条边界，见迁移 `debug_events.sql` 头注。
 */
import type { z } from "zod";
import { systemDebugTrace as C } from "@repo/contracts";
import { redactErrorMessage } from "./error-log.port";

/** 单源在契约（ADR-020）；这里只是 infer，不再写一遍字面量。 */
export type DebugEventLevel = z.infer<typeof C.DebugEventLevel>;

export interface DebugEventInput {
  readonly traceId: string;
  /** 点号分隔的开放字符串：`http.request` / `exception.unhandled` / `agent_run.failed` … */
  readonly kind: string;
  readonly level: DebugEventLevel;
  readonly msg: string;
  readonly data?: unknown;
  readonly durationMs?: number | null;
  readonly userId?: string | null;
  readonly orgId?: string | null;
}

/** 已脱敏、已定型的一条事件——缓冲与落库都用这个形状。 */
export interface DebugEvent {
  readonly traceId: string;
  readonly kind: string;
  readonly level: DebugEventLevel;
  readonly msg: string;
  readonly data: unknown;
  readonly durationMs: number | null;
  readonly userId: string | null;
  readonly orgId: string | null;
  readonly createdAt: string;
}

export interface DebugEventRow extends DebugEvent {
  readonly id: string;
}

export interface DebugEventQuery {
  readonly traceId?: string;
  readonly kind?: string;
  readonly level?: DebugEventLevel;
  readonly since?: string;
  readonly until?: string;
  readonly q?: string;
  readonly userId?: string;
  readonly limit: number;
  readonly beforeId: string | null;
}

export interface DebugEventPage {
  readonly items: readonly DebugEventRow[];
  readonly hasMore: boolean;
}

export interface DebugRecorderStats {
  readonly enabled: boolean;
  readonly buffered: number;
  readonly flushed: number;
  readonly dropped: number;
  readonly flushFailures: number;
  readonly lastFlushError: string | null;
  readonly lastFlushAt: string | null;
}

export interface DebugTracePort {
  /** 同步、不抛、不 await——见文件头第 1 条。 */
  record(event: DebugEventInput): void;
  /** 读库（`app_diag_ro`）。 */
  query(q: DebugEventQuery): Promise<DebugEventPage>;
  /** 一条链路全部事件，按时间正序。 */
  getTrace(traceId: string): Promise<readonly DebugEventRow[]>;
  /** 进程内环形缓冲里最近的事件（DB 不可用时的兜底视图；也包含还没来得及落库的）。 */
  recent(q: DebugEventQuery): DebugEventPage;
  stats(): DebugRecorderStats;
  /** 把缓冲里的事件立刻写出去（关机/测试用）。 */
  flush(): Promise<void>;
}

export const DEBUG_TRACE_PORT = Symbol("DebugTracePort");

/** 落库侧（infrastructure 实现）。 */
export interface DebugEventStore {
  insertBatch(events: readonly DebugEvent[]): Promise<void>;
  query(q: DebugEventQuery): Promise<DebugEventPage>;
  getTrace(traceId: string): Promise<readonly DebugEventRow[]>;
}

/* ─────────────────────────── 脱敏 ─────────────────────────── */

/** 整键丢弃——值是什么都不看，因为这些键的值几乎一定是机密。 */
const SECRET_KEY_RE = /(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|credential|private[-_]?key)/i;
const MAX_DEPTH = 6;
const MAX_KEYS = 64;
const MAX_ARRAY = 64;

/**
 * 深度脱敏一棵 JSON 值：机密键整键删；字符串值经 `redactErrorMessage`（连接串 / Bearer /
 * JWT / `password=` 等模式 + 2000 字截断）；深度 / 键数 / 数组长度都有上界，防止一个大
 * 对象把一条事件撑成几 MB。循环引用按 `"[cycle]"` 处理，不会递归到死。
 */
export function redactDebugData(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactErrorMessage(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return redactDebugData({ name: value.name, message: value.message, stack: value.stack }, depth, seen);
  }
  if (typeof value !== "object") return redactErrorMessage(String(value));
  if (depth >= MAX_DEPTH) return "[depth]";
  if (seen.has(value)) return "[cycle]";
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => redactDebugData(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (n++ >= MAX_KEYS) {
      out["[truncated]"] = true;
      break;
    }
    out[k] = redactDebugData(v, depth + 1, seen);
  }
  return out;
}

export function toDebugEvent(input: DebugEventInput, now: string): DebugEvent {
  return {
    traceId: input.traceId,
    kind: input.kind,
    level: input.level,
    msg: redactErrorMessage(input.msg),
    data: input.data === undefined ? null : redactDebugData(input.data),
    durationMs: typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? Math.round(input.durationMs) : null,
    userId: input.userId ?? null,
    orgId: input.orgId ?? null,
    createdAt: now,
  };
}
