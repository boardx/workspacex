/**
 * Phase 18 —— 知识图谱的失败码要到得了前端（F14 端到端发现的缺口）。
 *
 * `AllExceptionsFilter` 对 `reasonCode` 是允许列表：没登记的闭集会被静默丢掉，客户端只剩
 * `{ error: "conflict" }`。契约 `knowledgeGraph.KgErrorCode` 许诺的 `KG_REVISION_CHANGED`（409）、
 * `KG_NOT_OWNER`（403）等因此从未到过前端，`lib/knowledge-graph-failure.ts` 按码给的那句人话
 * （「内容已被更新，已为你刷新」之类）永远用不上。
 *
 * 仍是闭集：枚举外的 `KG_*` 字符串照样丢掉；不可见与不存在同一个出口（同码同体）不受影响。
 */
import { ConflictException, ForbiddenException, NotFoundException, type ArgumentsHost, type HttpException } from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ErrorLogPort } from "../../src/application/ports/error-log.port";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";

function respond(e: HttpException): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    headersSent: false,
    status: vi.fn((s: number) => { status = s; return res; }),
    json: vi.fn((b: Record<string, unknown>) => { body = b; return res; }),
    setHeader: vi.fn(),
  };
  const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: "t-kg" }), getResponse: () => res }) } as unknown as ArgumentsHost;
  const errorLog: ErrorLogPort = { record: vi.fn().mockResolvedValue(undefined), list: vi.fn(), getLifecycle: vi.fn(), updateLifecycle: vi.fn() };
  new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, errorLog).catch(e, host);
  return { status, body };
}

describe("知识图谱失败码经全局过滤器到达客户端", () => {
  it("契约 KgErrorCode 的每一个码都原样带出", () => {
    for (const code of KG.KgErrorCode.options) {
      expect(respond(new ConflictException({ reasonCode: code })).body.reasonCode, code).toBe(code);
    }
  });

  it("409 KG_REVISION_CHANGED / 403 KG_NOT_OWNER：状态码与码都在", () => {
    expect(respond(new ConflictException({ reasonCode: "KG_REVISION_CHANGED" }))).toMatchObject({ status: 409, body: { error: "conflict", reasonCode: "KG_REVISION_CHANGED" } });
    expect(respond(new ForbiddenException({ reasonCode: "KG_NOT_OWNER" }))).toMatchObject({ status: 403, body: { reasonCode: "KG_NOT_OWNER" } });
  });

  it("不可见与不存在仍是同一个出口：同码同体（traceId 之外）", () => {
    const a = respond(new NotFoundException({ reasonCode: "KG_THREAD_NOT_FOUND" }));
    const b = respond(new NotFoundException({ reasonCode: "KG_THREAD_NOT_FOUND" }));
    expect(a).toEqual(b);
  });

  it("反证：枚举外的 KG_ 字符串过不去（闭集，不成为探测面）", () => {
    expect(respond(new ConflictException({ reasonCode: "KG_SOMETHING_INTERNAL" })).body.reasonCode).toBeUndefined();
  });
});
