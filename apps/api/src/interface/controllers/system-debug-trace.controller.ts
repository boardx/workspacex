/**
 * `system-debug-trace` 契约束的三条只读路由（issue #3082）。
 *
 * 鉴权在 `PlatformOperatorGuard`，不在这里——与 `SystemErrorLogController` 同一理由：
 * `debug_events` 没有租户归属，按组织角色开放就是跨租户泄露。
 *
 * 查询参数全是原始字符串，这里只做「合法则用、不合法则回默认值」的收窄，不抛 400——
 * 这是给 agent 排障用的口，一个写错的过滤条件应该得到「更宽的结果」而不是一次拒绝。
 */
import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { systemDebugTrace as C } from "@repo/contracts";
import { DEBUG_TRACE_PORT, type DebugEventLevel, type DebugEventQuery, type DebugTracePort } from "../../application/ports/debug-trace.port";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { DEBUG_REQUEST_RECORDER, type DebugRequestRecorder } from "../middleware/debug-request-recorder";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function isoOrUndefined(v: string | undefined): string | undefined {
  if (v === undefined || v === "") return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function parseDebugEventQuery(raw: Record<string, string | undefined>): DebugEventQuery {
  const parsedLimit = raw.limit === undefined ? undefined : Number(raw.limit);
  const limit =
    parsedLimit !== undefined && Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= MAX_LIMIT
      ? parsedLimit
      : DEFAULT_LIMIT;
  const level = C.DebugEventLevel.safeParse(raw.level);
  const nonEmpty = (v: string | undefined): string | undefined => (v === undefined || v === "" ? undefined : v);
  return {
    traceId: nonEmpty(raw.traceId),
    kind: nonEmpty(raw.kind),
    level: level.success ? (level.data as DebugEventLevel) : undefined,
    since: isoOrUndefined(raw.since),
    until: isoOrUndefined(raw.until),
    q: nonEmpty(raw.q),
    userId: nonEmpty(raw.userId),
    limit,
    beforeId: raw.beforeId !== undefined && /^\d+$/.test(raw.beforeId) ? raw.beforeId : null,
  };
}

@Controller()
@UseGuards(PlatformOperatorGuard)
export class SystemDebugTraceController {
  constructor(
    @Inject(DEBUG_TRACE_PORT) private readonly trace: DebugTracePort,
    @Inject(DEBUG_REQUEST_RECORDER) private readonly requests: DebugRequestRecorder,
  ) {}

  @Get("/system/debug/events")
  async list(@CurrentPrincipal() principal: Principal, @Query() raw: Record<string, string | undefined>) {
    assertPrincipal(principal);
    const q = parseDebugEventQuery(raw);
    if (raw.source === "memory") return this.trace.recent(q);
    return this.trace.query(q);
  }

  @Get("/system/debug/traces/:traceId")
  async getTrace(@CurrentPrincipal() principal: Principal, @Param("traceId") traceId: string) {
    assertPrincipal(principal);
    const persisted = await this.trace.getTrace(traceId);
    // 还没落库的（缓冲里的）也补进来——「刚刚发生的那条」正是最常被查的。
    const seen = new Set(persisted.map((e) => `${e.createdAt}|${e.kind}|${e.msg}`));
    const pending = this.trace
      .recent({ traceId, limit: 500, beforeId: null })
      .items.filter((e) => !seen.has(`${e.createdAt}|${e.kind}|${e.msg}`));
    const items = [...persisted, ...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { traceId, items };
  }

  @Get("/system/debug/status")
  async status(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return { ...this.trace.stats(), inFlightRequests: this.requests.inFlightRequests() };
  }
}
