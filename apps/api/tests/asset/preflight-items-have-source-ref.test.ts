/**
 * F136 -- `uc-23-4` R3 第四项, domain I-22. Pure application-layer test, no Postgres (issue #74).
 *
 * The feature's whole point is that the preflight checklist is a *derived view*, not a
 * hand-written list -- so this file asserts derivation, not just "the list is non-empty":
 *
 *   1. **Every item carries a non-empty `sourceRef`** (I-22) -- a checklist item nobody can trace
 *      back to a rule is an unfalsifiable assertion.
 *   2. **The item set tracks `GOVERNANCE_FIELDS`, not a copy of it.** The test derives its own
 *      expectation from the very same `GOVERNANCE_FIELDS` array the implementation reads
 *      (`../../src/domain/asset/asset-governance`) instead of hardcoding
 *      `["visibility", "editableBy", "ownerId", "reviewCycle"]` -- if a field is ever added,
 *      renamed, or removed there, this test keeps asserting the CURRENT rule, it does not go
 *      stale the way a copy-pasted literal would ("规则变了，清单跟着变；不会出现规则早就改了、
 *      清单还在显示旧项这种情况").
 *   3. **At least one `blocking: true` red item is reproducible** -- an ungoverned asset must
 *      fail every governance-derived item. The feature's own notes warn against inheriting the
 *      prototype's defect where the checklist screen shows four PASS items and zero failures.
 *   4. **Passing individual fields flips their own item, and only their own item** -- proves the
 *      list is computed per-field, not a single hardcoded all-or-nothing blob.
 */
import { describe, expect, it } from "vitest";
import { runPreflightChecks } from "../../src/application/asset/run-preflight-checks";
import { GOVERNANCE_FIELDS } from "../../src/domain/asset/asset-governance";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
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

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };

const COMPLETE: AssetGovernanceRecord = {
  visibility: "specified-teams",
  teamIds: ["team-energy"],
  editableBy: ["u-owner"],
  ownerId: "u-owner",
  reviewCycle: "12m",
};

async function runFor(governance: AssetGovernanceRepository) {
  const deps = { repo: memberRepo, governance };
  return runPreflightChecks(deps, { userId: "u-owner", orgId, assetKind: "skill", assetId: "a1" });
}

describe("RunPreflightChecks -- 每一条都能追回来源 (I-22)", () => {
  it("每一项的 sourceRef 都非空", async () => {
    const result = await runFor(new InMemoryGovernanceRepo());
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.sourceRef.length).toBeGreaterThan(0);
    }
  });

  it("清单条目集合 = GOVERNANCE_FIELDS（不是照抄的第二份字面量）：改这个源数组，清单跟着变", async () => {
    const result = await runFor(new InMemoryGovernanceRepo());
    // Derived from the SAME array the implementation reads -- not a hardcoded literal here.
    expect(result.items.length).toBe(GOVERNANCE_FIELDS.length);
    for (const field of GOVERNANCE_FIELDS) {
      const item = result.items.find((i) => i.sourceRef.endsWith(`:${field}`));
      expect(item, `expected an item sourced from GOVERNANCE_FIELDS field "${field}"`).toBeDefined();
    }
    // Reverse direction too: no item points at a field GOVERNANCE_FIELDS doesn't contain.
    for (const item of result.items) {
      const field = item.sourceRef.split(":").pop();
      expect(GOVERNANCE_FIELDS as readonly string[]).toContain(field);
    }
  });

  it("反证：从未配置过治理的资产 -- 每一条都是 blocking:true 的红项，且 blockingCount 与红项数一致", async () => {
    const result = await runFor(new InMemoryGovernanceRepo());
    expect(result.items.every((i) => i.blocking)).toBe(true);
    expect(result.items.every((i) => i.passed === false)).toBe(true);
    expect(result.blockingCount).toBe(GOVERNANCE_FIELDS.length);
    expect(result.blockingCount).toBeGreaterThan(0); // 验收线：至少一条 blocking:true 的红项
  });

  it("完整配置 -> 全部通过，blockingCount = 0", async () => {
    const governance = new InMemoryGovernanceRepo();
    await governance.set("skill", "a1", COMPLETE);
    const result = await runFor(governance);
    expect(result.items.every((i) => i.passed)).toBe(true);
    expect(result.blockingCount).toBe(0);
  });

  it("只补齐 ownerId -> 只有 ownerId 那一条翻绿，其余仍红（逐字段派生，不是整块布尔）", async () => {
    // `AssetGovernanceRepository.set` only stores complete records (it is the persisted shape
    // for an already-governed asset), so "only ownerId ever configured" is exercised directly
    // against the pure domain function -- the same one `runPreflightChecks` calls -- rather than
    // forcing an invalid record through the port.
    const { assetPreflightItems } = await import("../../src/domain/asset/asset-preflight");
    const items = assetPreflightItems({ ownerId: "u-owner" });
    const ownerItem = items.find((i) => i.sourceRef.endsWith(":ownerId"))!;
    expect(ownerItem.passed).toBe(true);
    for (const item of items) {
      if (item === ownerItem) continue;
      expect(item.passed).toBe(false);
    }
  });
});
