import { describe, expect, it, vi } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { TokenUsageRecord } from "../../src/application/agent-run/ports";
import { PgTokenUsageRepository } from "../../src/infrastructure/auth/pg-token-usage-repository";
import { toOrgId } from "../../src/domain/org-id";

const org = toOrgId("usage-org");
const receipt: TokenUsageRecord = {
  eventId: "receipt-1", userId: "user-1", runId: "run-1", modelProvider: "provider", modelId: "model",
  tokensTotal: 120, promptTokens: 100, completionTokens: 20, outcome: "failed", totalSource: "reported",
  projectId: "project-1", threadId: "thread-1", agentId: "agent-1",
};
function database(query: (sql: string, params?: readonly unknown[]) => Promise<unknown>): DatabasePort {
  return {
    withTenant: async (tenant, fn) => { expect(tenant).toBe(org); return fn({ query: async (sql, params) => { await query(sql, params); return { rows: [] }; } }); },
    withoutTenant: async () => { throw new Error("cross-tenant access forbidden"); },
    close: async () => {},
  };
}
describe("token usage receipt boundary", () => {
  it("retries a lost acknowledgement with the same receipt and complete attribution", async () => {
    const query = vi.fn<TenantSession["query"]>()
      .mockRejectedValueOnce(Object.assign(new Error("lost ack"), { code: "ECONNRESET" }))
      .mockResolvedValue({ rows: [] });
    await new PgTokenUsageRepository(database(query)).record(org, receipt);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(query.mock.calls[1]?.[1]);
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (id) DO NOTHING");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "receipt-1", org, "user-1", "run-1", "provider", "model", 120, 100, 20, "failed",
      "reported", "project-1", "thread-1", "agent-1", null, null, null, null, null, null, null,
    ]);
  });
  it("generates distinct receipts for distinct attempts and keeps unknown distinct from zero", async () => {
    const query = vi.fn<TenantSession["query"]>().mockResolvedValue({ rows: [] });
    const repo = new PgTokenUsageRepository(database(query));
    const { eventId: _eventId, ...attempt } = receipt;
    await repo.record(org, { ...attempt, tokensTotal: 0, totalSource: "unknown", projectId: null });
    await repo.record(org, { ...attempt, tokensTotal: 0, totalSource: "reported", projectId: null });
    expect(query.mock.calls[0]?.[1]?.[0]).not.toEqual(query.mock.calls[1]?.[1]?.[0]);
    expect(query.mock.calls[0]?.[1]?.[10]).toBe("unknown");
    expect(query.mock.calls[1]?.[1]?.[10]).toBe("reported");
    expect(query.mock.calls[0]?.[1]?.[11]).toBeNull();
  });
  it("bounds transient failures and does not retry permission/schema failures", async () => {
    const query = vi.fn<TenantSession["query"]>().mockRejectedValue(Object.assign(new Error("serialization"), { code: "40001" }));
    await expect(new PgTokenUsageRepository(database(query)).record(org, receipt)).rejects.toThrow("serialization");
    expect(query).toHaveBeenCalledTimes(3);
    query.mockReset().mockRejectedValue(Object.assign(new Error("permission"), { code: "42501" }));
    await expect(new PgTokenUsageRepository(database(query)).record(org, receipt)).rejects.toThrow("permission");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid token count %s before SQL", async (tokensTotal) => {
    const query = vi.fn<TenantSession["query"]>().mockResolvedValue({ rows: [] });
    await expect(new PgTokenUsageRepository(database(query)).record(org, { ...receipt, tokensTotal })).rejects.toThrow("invalid token usage count");
    expect(query).not.toHaveBeenCalled();
  });
});
