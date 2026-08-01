/**
 * F137 -- `uc-23-4` R3 第五步 / R7 规则 1-2, domain I-5 / I-10. Pure application-layer test, no
 * Postgres (issue #74).
 *
 * `PublishAsset` has THREE independent禁用条件 (`GATE_NOT_PASSED` / `GOVERNANCE_INCOMPLETE` /
 * `PREFLIGHT_HAS_BLOCKING_ITEM`) -- merging them into one code would make it impossible for a
 * caller to tell WHICH thing needs fixing. This file constructs one counter-example per code,
 * each isolating that single condition while the other two are clean (see `publish-asset.ts`'s
 * header for why `GOVERNANCE_INCOMPLETE` and `PREFLIGHT_HAS_BLOCKING_ITEM` need two different
 * judgements to stay independent given today's preflight-derives-from-governance data shape).
 */
import { describe, expect, it } from "vitest";
import {
  GateNotPassedError,
  PreflightHasBlockingItemError,
  publishAsset,
  type PublishAssetDeps,
} from "../../src/application/asset/publish-asset";
import { GovernanceIncompleteError } from "../../src/application/asset/set-asset-governance";
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
const clock = { now: () => new Date("2026-08-01T00:00:00.000Z") };

const COMPLETE: AssetGovernanceRecord = {
  visibility: "specified-teams",
  teamIds: ["team-energy"],
  editableBy: ["u-owner"],
  ownerId: "u-owner",
  reviewCycle: "12m",
};

function deps(overrides: {
  governance: AssetGovernanceRepository;
  gates: AssetGateStatusPort;
  provenance: RecordingProvenanceWriter;
}): PublishAssetDeps {
  return {
    repo: memberRepo,
    governance: overrides.governance,
    gates: overrides.gates,
    provenance: overrides.provenance as unknown as ProvenanceWriter,
    clock,
  };
}

describe("PublishAsset -- 三条独立的禁用条件", () => {
  it("反例 1: 六道关阻断 -- 治理与发布前检查都干净，仍拒绝为 GATE_NOT_PASSED，且写审计", async () => {
    const governance = new InMemoryGovernanceRepo();
    await governance.set("skill", "a1", COMPLETE);
    const provenance = new RecordingProvenanceWriter();
    const gates = new StubGateStatus(true);

    await expect(
      publishAsset(deps({ governance, gates, provenance }), {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "a1",
        mode: "direct",
      }),
    ).rejects.toThrow(GateNotPassedError);

    expect(provenance.appended).toHaveLength(1);
    expect(provenance.appended[0]!.type).toBe("unauthorized-attempt");
    expect(provenance.appended[0]!.detail.reasonCode).toBe("GATE_NOT_PASSED");
  });

  it("反例 2: 从未配置过治理 -- 六道关干净，仍拒绝为 GOVERNANCE_INCOMPLETE（不是 PREFLIGHT）", async () => {
    const governance = new InMemoryGovernanceRepo(); // never .set() -- get() returns null
    const provenance = new RecordingProvenanceWriter();
    const gates = new StubGateStatus(false);

    await expect(
      publishAsset(deps({ governance, gates, provenance }), {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "a2",
        mode: "direct",
      }),
    ).rejects.toThrow(GovernanceIncompleteError);

    // Independence: this path never reaches the preflight branch, so no PREFLIGHT_* error, and
    // no publish-success audit event was written either.
    expect(provenance.appended).toHaveLength(0);
  });

  it("反例 3: 治理记录存在但字段被清空（绕过 setAssetGovernance 直接注入）-- 拒绝为 PREFLIGHT_HAS_BLOCKING_ITEM（不是 GOVERNANCE_INCOMPLETE）", async () => {
    const governance = new InMemoryGovernanceRepo();
    // Bypasses `setAssetGovernance`'s own completeness gate on purpose -- this simulates the
    // shape a future non-governance preflight item (e.g. a phase-2 trial-run finding) would
    // produce: a record that EXISTS (so `GOVERNANCE_INCOMPLETE`'s null-check does not fire) but
    // still yields a blocking preflight item.
    await governance.set("skill", "a3", { ...COMPLETE, editableBy: [] });
    const provenance = new RecordingProvenanceWriter();
    const gates = new StubGateStatus(false);

    await expect(
      publishAsset(deps({ governance, gates, provenance }), {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "a3",
        mode: "direct",
      }),
    ).rejects.toThrow(PreflightHasBlockingItemError);

    expect(provenance.appended).toHaveLength(0);
  });

  it("两条都清 -> 可发布", async () => {
    const governance = new InMemoryGovernanceRepo();
    await governance.set("skill", "a4", COMPLETE);
    const provenance = new RecordingProvenanceWriter();
    const gates = new StubGateStatus(false);

    const result = await publishAsset(deps({ governance, gates, provenance }), {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a4",
      mode: "direct",
    });

    expect(result.publishedBy).toBe("u-owner");
    expect(provenance.appended).toHaveLength(1);
    expect(provenance.appended[0]!.type).toBe("asset-published");
  });
});
