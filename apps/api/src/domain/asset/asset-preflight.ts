/**
 * `assetPreflightItems` -- F136 (`uc-23-4` R3 第四项, domain I-22).
 *
 * Pure predicate that turns an in-flight `AssetGovernance` draft into the "发布前检查" list the
 * contract's `runPreflightChecks` operation returns. The whole point of this feature is that the
 * list is a *derived view*, not a hand-written array someone edits by hand:
 *
 *   - The item set is produced by `.map()`-ing over `GOVERNANCE_FIELDS`
 *     (`./asset-governance.ts`) -- the exact same array `assetGovernanceMissingFields` iterates.
 *     There is no second, independently-typed list of "the four things we check" living here.
 *     Add/remove/rename a field in `GOVERNANCE_FIELDS` and this list's length, labels and
 *     `sourceRef`s change with it -- nothing here would need to be touched or would stay stale.
 *   - Every item's `sourceRef` points back at the single place the underlying rule is defined
 *     (`asset-governance.ts#GOVERNANCE_FIELDS:<field>`), never a bare "OK/missing" claim with no
 *     way to check where it came from (domain I-22: "追不回来源的检查项等于一句无从核对的断言").
 *
 * ⚠ This module does not (and must not) invent a `TrialRun`-derived item (`uc-23-5`'s `!`-level
 * findings) -- that mechanism is deferred to phase-2 with sandboxed execution (D-06, Q-0 plan C).
 * Wiring a phase-2-only port in here to satisfy I-22's illustrative example would be inventing a
 * port Q-0 explicitly did not place in phase-1. The governance-completeness fields are the one
 * concrete, phase-1-real rule source available today; that is what this derives from.
 *
 * ⚠ Content is deliberately NOT the prototype's "四栏配置完整" (Agent-only) item -- Q-1b hasn't
 * ruled whether the six `AssetKind`s share one governance shape, and this function's whole
 * design keeps that question open by not branching on `assetKind` at all (same posture as
 * `assetGovernanceMissingFields`). What IS locked down is "every item is traceable" -- not the
 * item content itself (issue notes, `F136`).
 */
import { assetGovernanceMissingFields, GOVERNANCE_FIELDS, type AssetGovernanceDraft, type GovernanceField } from "./asset-governance";

export interface AssetPreflightItem {
  readonly label: string;
  readonly detail: string;
  readonly passed: boolean;
  readonly blocking: boolean;
  /** ⚠ Never empty -- see header. Always `asset-governance.ts#GOVERNANCE_FIELDS:<field>`. */
  readonly sourceRef: string;
}

const GOVERNANCE_FIELD_LABEL: Readonly<Record<GovernanceField, string>> = {
  visibility: "可见范围已设置",
  editableBy: "谁能改已设置",
  ownerId: "已指定负责人",
  reviewCycle: "复核周期已设置",
};

const GOVERNANCE_FIELD_DETAIL_MISSING: Readonly<Record<GovernanceField, string>> = {
  visibility: "缺少可见范围（指定团队 / 全组织 / 仅自己-私有草稿）",
  editableBy: "缺少「谁能改」——至少需要一个可编辑者",
  ownerId: "缺少负责人",
  reviewCycle: "缺少复核周期（6 / 12 / 24 个月）",
};

const GOVERNANCE_FIELD_DETAIL_PASSED: Readonly<Record<GovernanceField, string>> = {
  visibility: "可见范围已配置",
  editableBy: "已指定至少一个可编辑者",
  ownerId: "负责人已指定",
  reviewCycle: "复核周期已选定",
};

function sourceRefFor(field: GovernanceField): string {
  return `asset-governance.ts#GOVERNANCE_FIELDS:${field}`;
}

/**
 * Derives the preflight checklist from `GOVERNANCE_FIELDS` -- the same array
 * `assetGovernanceMissingFields` reads. Every one of the four governance fields (I-10) is a
 * `blocking: true` item: `GOVERNANCE_INCOMPLETE` is one of the three independent publish-blocking
 * conditions the contract defines, so an incomplete governance field genuinely blocks publish,
 * it is not merely advisory.
 */
export function assetPreflightItems(draft: AssetGovernanceDraft): AssetPreflightItem[] {
  const missing = new Set(assetGovernanceMissingFields(draft));
  return GOVERNANCE_FIELDS.map((field) => {
    const passed = !missing.has(field);
    return {
      label: GOVERNANCE_FIELD_LABEL[field],
      detail: passed ? GOVERNANCE_FIELD_DETAIL_PASSED[field] : GOVERNANCE_FIELD_DETAIL_MISSING[field],
      passed,
      blocking: true,
      sourceRef: sourceRefFor(field),
    };
  });
}
