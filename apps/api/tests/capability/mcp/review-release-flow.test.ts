import { describe, expect, it } from "vitest";
import { evaluateMcpReview, reviewOutcomeStatus } from "../../../src/domain/mcp/review-flow";
import {
  reviewMcpServer,
  McpReviewRejectedError,
} from "../../../src/application/mcp/review-mcp-server";
import type { ProvenanceWriter } from "../../../src/application/provenance/ports";
import type { ReviewRecordStore } from "../../../src/application/mcp/ports";
import { toOrgId } from "../../../src/domain/org-id";

/**
 * F54 (UC-21.2 R3 步骤 2-4 / R5 / R12 V4) -- 放行评审流程。
 *
 * 反向断言优先：注册人自审被拒、放行未设范围被拒、理由为空被拒，
 * 且每条拒绝都不产生任何留痕、不产生任何评审记录（不留半截状态）。
 */

function fakeReviewStore(): ReviewRecordStore & { records: unknown[] } {
  const records: unknown[] = [];
  return {
    records,
    async append(record) {
      records.push(record);
    },
    async listByServer(serverId) {
      return records.filter((r) => (r as { serverId: string }).serverId === serverId) as {
        reviewerId: string;
      }[];
    },
  };
}

function fakeProvenance(): ProvenanceWriter & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async append(input) {
      events.push(input);
      return `ev-${events.length}`;
    },
    async appendWithin(_s, input) {
      events.push(input);
      return `ev-${events.length}`;
    },
  };
}

const requestId = { next: (() => {
  let n = 0;
  return () => `review-${++n}`;
})() };

describe("F54 · evaluateMcpReview -- 纯函数判定", () => {
  const base = {
    serverReviewStatus: "待安全评审" as const,
    registeredByActorId: "u-registrant",
    reviewerId: "u-reviewer",
    verdict: "放行" as const,
    reason: "已核实供应商 SOC2 报告",
    authScope: "仅项目负责人" as const,
  };

  it("正常放行：全部条件满足 ⇒ 通过", () => {
    expect(evaluateMcpReview(base).ok).toBe(true);
  });

  it("反证：注册人对自己注册的服务器评审 ⇒ SELF_REVIEW_FORBIDDEN", () => {
    const r = evaluateMcpReview({ ...base, reviewerId: base.registeredByActorId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("SELF_REVIEW_FORBIDDEN");
  });

  it("反证：理由为空白字符串 ⇒ REVIEW_REASON_REQUIRED（不是恰好被 zod 的 min(1) 挡住）", () => {
    const r = evaluateMcpReview({ ...base, reason: "   " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("REVIEW_REASON_REQUIRED");
  });

  it("反证：放行但未设授权范围 ⇒ SCOPE_REQUIRED_ON_RELEASE", () => {
    const r = evaluateMcpReview({ ...base, authScope: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("SCOPE_REQUIRED_ON_RELEASE");
  });

  it("维持隔离时不要求授权范围——SCOPE_REQUIRED_ON_RELEASE 只在「放行」时触发", () => {
    expect(evaluateMcpReview({ ...base, verdict: "维持隔离", authScope: null }).ok).toBe(true);
  });

  it("反证：对已经「已放行」的服务器再走评审 ⇒ WRONG_REVIEW_FUNCTION（该走重新隔离）", () => {
    const r = evaluateMcpReview({ ...base, serverReviewStatus: "已放行" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("WRONG_REVIEW_FUNCTION");
  });

  it("已到期待复核（F131）的服务器仍可评审——不属于 WRONG_REVIEW_FUNCTION", () => {
    expect(evaluateMcpReview({ ...base, serverReviewStatus: "已到期待复核" }).ok).toBe(true);
  });
});

describe("F54 · reviewOutcomeStatus -- 结论到服务器状态的唯一映射", () => {
  it("放行 ⇒ 已放行 + 已连接", () => {
    expect(reviewOutcomeStatus("放行")).toEqual({ reviewStatus: "已放行", connectionStatus: "已连接" });
  });
  it("维持隔离 ⇒ 维持隔离 + 已隔离", () => {
    expect(reviewOutcomeStatus("维持隔离")).toEqual({ reviewStatus: "维持隔离", connectionStatus: "已隔离" });
  });
  it("有条件放行 ⇒ 有条件放行 + 已连接（部分工具，非服务器整体不可用）", () => {
    expect(reviewOutcomeStatus("有条件放行")).toEqual({
      reviewStatus: "有条件放行",
      connectionStatus: "已连接",
    });
  });
});

describe("F54 · reviewMcpServer -- 服务端用例：拒绝路径不留半截状态", () => {
  const server = {
    serverId: "mcp-eu-reg",
    registeredByActorId: "u-registrant",
    reviewStatus: "待安全评审" as const,
  };

  it("正常放行：产生一条评审记录 + 一条 provenance 事件，服务器转已连接", async () => {
    const reviews = fakeReviewStore();
    const provenance = fakeProvenance();
    const result = await reviewMcpServer(
      { reviews, provenance, requestId },
      {
        orgId: toOrgId("org-f54"),
        server,
        reviewerId: "u-reviewer",
        verdict: "放行",
        reason: "已核实供应商审计报告",
        authScope: "仅项目负责人",
        grantedToolIds: [],
      },
    );
    expect(result.reviewStatus).toBe("已放行");
    expect(result.connectionStatus).toBe("已连接");
    expect(reviews.records).toHaveLength(1);
    expect(provenance.events).toHaveLength(1);
  });

  it("反证：自审被拒 ⇒ 抛错，且不产生任何评审记录或留痕（不留半截状态）", async () => {
    const reviews = fakeReviewStore();
    const provenance = fakeProvenance();
    await expect(
      reviewMcpServer(
        { reviews, provenance, requestId },
        {
          orgId: toOrgId("org-f54"),
          server,
          reviewerId: server.registeredByActorId,
          verdict: "放行",
          reason: "自己批自己",
          authScope: "全体成员",
          grantedToolIds: [],
        },
      ),
    ).rejects.toThrow(McpReviewRejectedError);
    expect(reviews.records).toHaveLength(0);
    expect(provenance.events).toHaveLength(0);
  });

  it("反证：放行未设范围 ⇒ 抛错，不留半截记录", async () => {
    const reviews = fakeReviewStore();
    const provenance = fakeProvenance();
    await expect(
      reviewMcpServer(
        { reviews, provenance, requestId },
        {
          orgId: toOrgId("org-f54"),
          server,
          reviewerId: "u-reviewer",
          verdict: "放行",
          reason: "看起来没问题",
          authScope: null,
          grantedToolIds: [],
        },
      ),
    ).rejects.toThrow(McpReviewRejectedError);
    expect(reviews.records).toHaveLength(0);
    expect(provenance.events).toHaveLength(0);
  });

  it("留痕写入失败 ⇒ 整个评审失败，评审记录不落库（没有留痕就没有评审）", async () => {
    const reviews = fakeReviewStore();
    const failingProvenance: ProvenanceWriter = {
      async append() {
        throw new Error("provenance unavailable");
      },
      async appendWithin() {
        throw new Error("provenance unavailable");
      },
    };
    await expect(
      reviewMcpServer(
        { reviews, provenance: failingProvenance, requestId },
        {
          orgId: toOrgId("org-f54"),
          server,
          reviewerId: "u-reviewer",
          verdict: "放行",
          reason: "看起来没问题",
          authScope: "全体成员",
          grantedToolIds: [],
        },
      ),
    ).rejects.toThrow(/provenance unavailable/);
    expect(reviews.records).toHaveLength(0);
  });

  it("评审记录不可删除/不可修改——ReviewRecordStore 的类型上根本没有 update/delete 方法", () => {
    const reviews = fakeReviewStore();
    expect((reviews as unknown as { update?: unknown }).update).toBeUndefined();
    expect((reviews as unknown as { delete?: unknown }).delete).toBeUndefined();
  });
});
