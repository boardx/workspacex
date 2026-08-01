/**
 * F137 -- `uc-23-4` R9 / R6 / E6, "发布必须写审计（谁 / 什么资产 / 什么可见范围 / 什么时间）".
 * Pure application-layer test, no Postgres (issue #74).
 *
 * Asserts the audit trail on BOTH outcomes: a successful publish writes `asset-published` with
 * who/what-asset/what-visibility/what-time, AND a `GATE_NOT_PASSED` denial also writes an audit
 * event (`uc-23-4` E6: "必须拒绝并写审计", not just "reject silently"). `unauthorized-attempt`
 * is the reused code (same precedent as `reveal-contact.ts`: a denied attempt is itself worth a
 * trail) -- see `publish-asset.ts`'s header for why `GOVERNANCE_INCOMPLETE` /
 * `PREFLIGHT_HAS_BLOCKING_ITEM` do not separately audit (they are the caller's own unfinished
 * configuration, not an unauthorized attempt).
 */
import { describe, expect, it } from "vitest";
import { GateNotPassedError, publishAsset } from "../../src/application/asset/publish-asset";
import type { AssetGovernanceRecord, AssetGovernanceRepository, AssetGateStatusPort } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import type { ProvenanceAppendInput, ProvenanceWriter } from "../../src/application/provenance/ports";
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

class StubGateStatus implements AssetGateStatusPort {
  constructor(private readonly blocking: boolean) {}
  async hasBlockingGate() {
    return this.blocking;
  }
}

class RecordingProvenanceWriter implements Pick<ProvenanceWriter, "append"> {
  readonly appended: ProvenanceAppendInput[] = [];
  async append(input: ProvenanceAppendInput): Promise<string> {
    this.appended.push(input);
    return `evt-${this.appended.length}`;
  }
  async appendWithin(): Promise<string> {
    throw new Error("not used in this test");
  }
}

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };
const clock = { now: () => new Date("2026-08-01T12:00:00.000Z") };

const COMPLETE: AssetGovernanceRecord = {
  visibility: "whole-org",
  teamIds: [],
  editableBy: ["u-owner"],
  ownerId: "u-owner",
  reviewCycle: "24m",
};

describe("PublishAsset -- 发布写审计（谁 / 什么资产 / 什么可见范围 / 什么时间）", () => {
  it("发布成功 -> 写一条 asset-published，携带 actor / target / visibility / 时间，且 auditEventId 回到 out", async () => {
    const governance = new InMemoryGovernanceRepo();
    await governance.set("agent", "asset-9", COMPLETE);
    const provenance = new RecordingProvenanceWriter();

    const result = await publishAsset(
      {
        repo: memberRepo,
        governance,
        gates: new StubGateStatus(false),
        provenance: provenance as unknown as ProvenanceWriter,
        clock,
      },
      { userId: "u-publisher", orgId, assetKind: "agent", assetId: "asset-9", mode: "direct" },
    );

    expect(provenance.appended).toHaveLength(1);
    const event = provenance.appended[0]!;
    expect(event.type).toBe("asset-published");
    expect(event.orgId).toBe(orgId);
    expect(event.actorId).toBe("u-publisher"); // 谁
    expect(event.target).toEqual({ kind: "asset", id: "asset-9" }); // 什么资产
    expect(event.detail.visibility).toBe("whole-org"); // 什么可见范围
    expect(event.detail.publishedAt).toBe("2026-08-01T12:00:00.000Z"); // 什么时间
    expect(event.detail.assetKind).toBe("agent");

    // The auditEventId the use case returns IS the id `append` produced -- not a second,
    // independently-generated id that could point at a different row.
    expect(result.auditEventId).toBe("evt-1");
  });

  it("GATE_NOT_PASSED 拒绝也写审计（E6：拒绝且留痕，不是静默拒绝）", async () => {
    const governance = new InMemoryGovernanceRepo();
    await governance.set("agent", "asset-10", COMPLETE);
    const provenance = new RecordingProvenanceWriter();

    await expect(
      publishAsset(
        {
          repo: memberRepo,
          governance,
          gates: new StubGateStatus(true),
          provenance: provenance as unknown as ProvenanceWriter,
          clock,
        },
        { userId: "u-publisher", orgId, assetKind: "agent", assetId: "asset-10", mode: "direct" },
      ),
    ).rejects.toThrow(GateNotPassedError);

    expect(provenance.appended).toHaveLength(1);
    const event = provenance.appended[0]!;
    expect(event.type).toBe("unauthorized-attempt");
    expect(event.actorId).toBe("u-publisher");
    expect(event.target).toEqual({ kind: "asset", id: "asset-10" });
    expect(event.detail.reasonCode).toBe("GATE_NOT_PASSED");
  });
});
