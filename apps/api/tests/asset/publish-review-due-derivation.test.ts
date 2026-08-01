/**
 * F137 -- `uc-23-4` R6 / R7 规则 5, domain invariant `reviewDueAt = publishedAt + reviewCycle`.
 * Pure application-layer test, no Postgres (issue #74).
 *
 * `reviewDueAt` is asserted as a DERIVATION, not an independently-writable field: `PublishAsset`
 * takes no `reviewDueAt` input, so the only way to prove the invariant is to change the input
 * that feeds it (`reviewCycle`) and re-publish, and watch the output track it.
 *
 * ⚠ This file does not, and must not, assert anything about the 30-day-no-review downgrade
 * clock -- that is `uc-23-6` / Q-7's territory (see `domain/asset/asset-review-clock.ts`'s
 * header). It only asserts the calendar-month arithmetic `ReviewCycle`'s own literal names
 * already state.
 */
import { describe, expect, it } from "vitest";
import { publishAsset, type PublishAssetDeps } from "../../src/application/asset/publish-asset";
import type { AssetGovernanceRecord, AssetGovernanceRepository, AssetGateStatusPort } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import type { ProvenanceAppendInput, ProvenanceWriter } from "../../src/application/provenance/ports";
import { deriveReviewDueAt } from "../../src/domain/asset/asset-review-clock";
import { toOrgId } from "../../src/domain/org-id";

class InMemoryGovernanceRepo implements AssetGovernanceRepository {
  private readonly store = new Map<string, AssetGovernanceRecord>();
  async get(assetKind: string, assetId: string) {
    return this.store.get(`${assetKind}:${assetId}`) ?? null;
  }
  async set(assetKind: string, assetId: string, governance: AssetGovernanceRecord) {
    this.store.set(`${assetKind}:${assetId}`, governance);
  }
}

class AlwaysOpenGate implements AssetGateStatusPort {
  async hasBlockingGate() {
    return false;
  }
}

class NoopProvenanceWriter implements Pick<ProvenanceWriter, "append"> {
  async append(_input: ProvenanceAppendInput): Promise<string> {
    return "evt-1";
  }
  async appendWithin(): Promise<string> {
    throw new Error("not used in this test");
  }
}

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };

function depsAt(now: string): PublishAssetDeps {
  return {
    repo: memberRepo,
    governance: new InMemoryGovernanceRepo(),
    gates: new AlwaysOpenGate(),
    provenance: new NoopProvenanceWriter() as unknown as ProvenanceWriter,
    clock: { now: () => new Date(now) },
  };
}

async function publishWithCycle(reviewCycle: AssetGovernanceRecord["reviewCycle"], publishedAt: string) {
  const d = depsAt(publishedAt);
  await d.governance.set("skill", "a1", {
    visibility: "specified-teams",
    teamIds: ["team-energy"],
    editableBy: ["u-owner"],
    ownerId: "u-owner",
    reviewCycle,
  });
  return publishAsset(d, { userId: "u-owner", orgId, assetKind: "skill", assetId: "a1", mode: "direct" });
}

describe("PublishAsset -- reviewDueAt = publishedAt + reviewCycle", () => {
  it("12m 周期: reviewDueAt 恰为 publishedAt 之后 12 个日历月", async () => {
    const result = await publishWithCycle("12m", "2026-08-01T00:00:00.000Z");
    expect(result.publishedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(result.reviewDueAt).toBe("2027-08-01T00:00:00.000Z");
    expect(result.reviewDueAt).toBe(deriveReviewDueAt(result.publishedAt, "12m"));
  });

  it("改周期后重发布，到期日跟着变（6m / 24m 两档反证）", async () => {
    const sixMonths = await publishWithCycle("6m", "2026-08-01T00:00:00.000Z");
    expect(sixMonths.reviewDueAt).toBe("2027-02-01T00:00:00.000Z");

    const twentyFourMonths = await publishWithCycle("24m", "2026-08-01T00:00:00.000Z");
    expect(twentyFourMonths.reviewDueAt).toBe("2028-08-01T00:00:00.000Z");

    // Same publishedAt, different reviewCycle -> different reviewDueAt: proves the value is
    // derived from the cycle, not a fixed offset.
    expect(sixMonths.reviewDueAt).not.toBe(twentyFourMonths.reviewDueAt);
  });

  it("同一周期、不同发布时刻 -> 到期日跟着 publishedAt 平移", async () => {
    const later = await publishWithCycle("6m", "2026-09-15T08:30:00.000Z");
    expect(later.reviewDueAt).toBe("2027-03-15T08:30:00.000Z");
  });
});
