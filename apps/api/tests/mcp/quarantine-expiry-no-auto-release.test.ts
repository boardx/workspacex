import { describe, expect, it } from "vitest";
import {
  computeQuarantineUntil,
  reviewStatusOnQuarantineExpiry,
} from "../../src/domain/mcp/quarantine";
import type { ReviewStatus } from "../../src/domain/mcp/server-status";

/**
 * F131 (UC-21.1 R3 步骤 3 补 / I-30′) -- 期满不自动开放。
 *
 * 原型逐字「期满复核后才对成员开放」——到期只是让「复核」这件事变得可做，放行仍是人的
 * 动作。⚠ 断言必须打在它**没有**转成 `已放行`，不是只断言它「还是隔离」：只写后一半的话，
 * 一个「到期后 reviewStatus 保持 待安全评审 不变」的实现（同样"不是已放行"）会与
 * "转到已到期待复核"的正确实现一起全绿，掩盖"静默停在待安全评审里无人处理"这个原型
 * 明确要防的失败模式。
 */

const registeredAt = new Date("2026-08-01T00:00:00Z");
const quarantineUntil = computeQuarantineUntil(registeredAt, 14);
const beforeExpiry = new Date("2026-08-10T00:00:00Z");
const afterExpiry = new Date("2026-08-20T00:00:00Z");

describe("F131 · reviewStatusOnQuarantineExpiry -- 待安全评审 + 期满 ⇒ 已到期待复核", () => {
  it("期满前：`待安全评审` 原样保持，不提前转态", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "待安全评审",
      quarantineUntil,
      now: beforeExpiry,
    });
    expect(next).toBe("待安全评审");
  });

  it("期满后：`待安全评审` 转为 `已到期待复核`——不是静默停留，也不是自动放行", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "待安全评审",
      quarantineUntil,
      now: afterExpiry,
    });
    expect(next).toBe("已到期待复核");
  });

  it("⚠ 核心反证：期满后的结果**不是** `已放行`——期满只解锁复核，不解锁放行", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "待安全评审",
      quarantineUntil,
      now: afterExpiry,
    });
    expect(next).not.toBe("已放行");
  });

  it("已经被人复核过的三态不因期满被撤销：`已放行` 原样返回", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "已放行",
      quarantineUntil,
      now: afterExpiry,
    });
    expect(next).toBe("已放行");
  });

  it("已经被人复核过的三态不因期满被撤销：`有条件放行` 原样返回", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "有条件放行",
      quarantineUntil,
      now: afterExpiry,
    });
    expect(next).toBe("有条件放行");
  });

  it("已经被人复核过的三态不因期满被撤销：`维持隔离` 原样返回", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "维持隔离",
      quarantineUntil,
      now: afterExpiry,
    });
    expect(next).toBe("维持隔离");
  });

  it("穷举五态：只有 `待安全评审` × 期满 这一格会变化，其余四态 × 期满前后都原样返回", () => {
    const allStatuses: readonly ReviewStatus[] = [
      "待安全评审",
      "已放行",
      "维持隔离",
      "有条件放行",
      "已到期待复核",
    ];
    for (const status of allStatuses) {
      for (const now of [beforeExpiry, afterExpiry]) {
        const next = reviewStatusOnQuarantineExpiry({ reviewStatus: status, quarantineUntil, now });
        const shouldChange = status === "待安全评审" && now === afterExpiry;
        if (shouldChange) {
          expect(next, `status=${status} now=${now.toISOString()}`).toBe("已到期待复核");
        } else {
          expect(next, `status=${status} now=${now.toISOString()}`).toBe(status);
        }
      }
    }
  });

  it("`quarantineUntil === null`（非第三方源）恒不转态，即便传入很晚的 now", () => {
    const next = reviewStatusOnQuarantineExpiry({
      reviewStatus: "待安全评审",
      quarantineUntil: null,
      now: new Date("2099-01-01T00:00:00Z"),
    });
    expect(next).toBe("待安全评审");
  });
});
