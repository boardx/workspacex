/**
 * The five admission verdicts and the gate they open (F49 / uc-20-1 R3 步骤 5,
 * `contracts/agent-runtime/domain.md` `AdmissionTest`, invariants I-1 and I-7).
 *
 * Innermost layer: no HTTP, no SQL, no clock. Every enum here is DERIVED from
 * `@repo/contracts`; a second copy of "the five items" is the same-fact-twice failure this
 * project has recorded five times.
 *
 * ## The gate is a function over a LOG, not a read of five booleans
 *
 * I-7 makes the store append-only: a re-judgement is a second record. So "has this model
 * passed 结构化输出" is not a lookup, it is `the last record for that item, by append
 * order`. Writing the gate over the log rather than over a derived summary means there is
 * no summary to fall out of date -- and it means the counter-proof "改判之后旧判读仍在"
 * is a property of the same data the gate reads, not of a second table nobody checks.
 *
 * ## Why `requiredItems` is a parameter with a default
 *
 * `admissionGate(records)` over an empty required set would return "pass" for a model with
 * no verdicts at all: every required item is satisfied, vacuously. That is this project's
 * most repeated failure mode -- a gate that is green because it is idle -- so the emptiness
 * is refused IN the gate (`ADMISSION_ITEMS_UNDECLARED`) rather than assumed away, and the
 * parameter exists so a test can actually reach that branch. Production never passes it.
 */
import { agentRuntime as C } from "@repo/contracts";
import type { z } from "zod";

/** Derived, never restated. */
export type AdmissionTestItem = z.infer<typeof C.AdmissionTestItem>;
export type AdmissionVerdict = z.infer<typeof C.AdmissionVerdict>;
export type AdmissionTestRecord = z.infer<typeof C.AdmissionTestRecord>;

/**
 * The closed set of items. ⚠ This constant is the ONLY place the API layer, the gate and
 * the migration's CHECK are reconciled against; `admission-test-gate.test.ts` asserts set
 * equality with the contract AND with the SQL, in both directions.
 */
export const ADMISSION_TEST_ITEMS: readonly AdmissionTestItem[] = C.AdmissionTestItem.options;

export const ADMISSION_VERDICTS: readonly AdmissionVerdict[] = C.AdmissionVerdict.options;

/**
 * The one verdict that satisfies I-1.
 *
 * ⚠ `不适用` is NOT in this set, and that is the ruling, not an oversight. I-1 reads 「五项
 * 准入测试的最新判读**全部为「通过」**」. Admitting `不适用` would let a model be enabled
 * with 工具调用 marked "does not apply", which is the exact judgement the enable gate is
 * supposed to make a human defend.
 */
export const PASSING_VERDICT: AdmissionVerdict = "通过";

/**
 * One stored verdict, plus the append order the store assigned it.
 *
 * `seq` and not just `judgedAt`: two judgements of the same item can share a millisecond,
 * and a clock that steps backwards makes it worse. With only a timestamp, "the latest
 * verdict" is a coin toss and the coin decides whether the model may be enabled.
 */
export interface StoredAdmissionTest extends AdmissionTestRecord {
  readonly seq: number;
}

/**
 * The latest verdict per item, by append order.
 *
 * ⚠ Returns a map that OMITS items with no record. It does not default them to `不通过`:
 * "judged and failed" and "never judged" are different things to tell an admin, and the
 * gate below reports them differently for exactly that reason.
 */
export function latestVerdicts(
  records: readonly StoredAdmissionTest[],
): ReadonlyMap<AdmissionTestItem, StoredAdmissionTest> {
  const latest = new Map<AdmissionTestItem, StoredAdmissionTest>();
  for (const record of records) {
    const held = latest.get(record.item);
    if (held === undefined || record.seq > held.seq) latest.set(record.item, record);
  }
  return latest;
}

/**
 * Every record ever written for one item, oldest first.
 *
 * Exists so "改判留双份" is answerable through the domain rather than only by reading SQL:
 * after a re-judgement this returns both, and `seq` says which is which.
 */
export function verdictHistory(
  records: readonly StoredAdmissionTest[],
  item: AdmissionTestItem,
): readonly StoredAdmissionTest[] {
  return records.filter((r) => r.item === item).slice().sort((a, b) => a.seq - b.seq);
}

/** Why one item does not satisfy I-1. Distinguished because the remedies differ. */
export type ItemBlock =
  | { readonly item: AdmissionTestItem; readonly reason: "never-judged" }
  | {
      readonly item: AdmissionTestItem;
      readonly reason: "latest-verdict-not-passing";
      readonly verdict: AdmissionVerdict;
    };

export const ADMISSION_TESTS_INCOMPLETE = "ADMISSION_TESTS_INCOMPLETE" as const;

/**
 * ⚠ Not one of the contract's error codes, and deliberately not added to it. It cannot be
 * reached by any request: it fires only when the required item set is empty, which in
 * production is a compile-time constant of five. It exists so the vacuous-pass branch has a
 * name a test can assert on instead of being unreachable and therefore unverified.
 */
export const ADMISSION_ITEMS_UNDECLARED = "ADMISSION_ITEMS_UNDECLARED" as const;

export type AdmissionGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof ADMISSION_TESTS_INCOMPLETE;
      /** ⚠ Never empty when `ok` is false: uc-20-1 「必须指出卡在哪一项」. */
      readonly blocked: readonly ItemBlock[];
    }
  | { readonly ok: false; readonly code: typeof ADMISSION_ITEMS_UNDECLARED };

/**
 * I-1 for a single record: may this model be enabled?
 *
 * ⚠ The result names the offending items. `usecases.md` on `ADMISSION_TESTS_INCOMPLETE`:
 * 「必须指出卡在哪一项」 -- a gate that only says "tests incomplete" degrades into a riddle,
 * and the admin's next action is to re-run all five.
 */
export function admissionGate(
  records: readonly StoredAdmissionTest[],
  requiredItems: readonly AdmissionTestItem[] = ADMISSION_TEST_ITEMS,
): AdmissionGateResult {
  // See the header: an empty requirement makes every model pass, including one with no
  // verdicts whatsoever. Refused rather than treated as satisfied.
  if (requiredItems.length === 0) return { ok: false, code: ADMISSION_ITEMS_UNDECLARED };

  const latest = latestVerdicts(records);
  const blocked: ItemBlock[] = [];
  for (const item of requiredItems) {
    const record = latest.get(item);
    if (record === undefined) {
      blocked.push({ item, reason: "never-judged" });
    } else if (record.verdict !== PASSING_VERDICT) {
      blocked.push({ item, reason: "latest-verdict-not-passing", verdict: record.verdict });
    }
  }
  return blocked.length === 0 ? { ok: true } : { ok: false, code: ADMISSION_TESTS_INCOMPLETE, blocked };
}

/** One member of a composite, with its own log. */
export interface MemberAdmission {
  readonly modelId: string;
  readonly records: readonly StoredAdmissionTest[];
}

/**
 * ⚠ Also not a contract error code, and also deliberately not added to one.
 * `enableModel.err` is a fixed four-member list in a bundle awaiting human sign-off, and
 * `contract-design.md` §五 forbids an agent widening it. So the DOMAIN distinguishes "a
 * composite with no members at all" -- which is neither "an item was never judged" nor "a
 * member failed", and would otherwise be reported as `ok: false` with nothing named -- and
 * the use case reports it on the wire as `ADMISSION_TESTS_INCOMPLETE`, which is true of it.
 */
export const COMPOSITE_HAS_NO_MEMBERS = "COMPOSITE_HAS_NO_MEMBERS" as const;

export type CompositeAdmissionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof ADMISSION_TESTS_INCOMPLETE;
      /** The composite record's OWN five, when they are what is missing. */
      readonly blocked: readonly ItemBlock[];
      /** Members that have not each passed on their own. */
      readonly blockedMembers: readonly { readonly modelId: string; readonly blocked: readonly ItemBlock[] }[];
    }
  | { readonly ok: false; readonly code: typeof COMPOSITE_HAS_NO_MEMBERS }
  | { readonly ok: false; readonly code: typeof ADMISSION_ITEMS_UNDECLARED };

/**
 * I-1 for a composite record (O-22③): the members must EACH have passed, **and the
 * composite itself must have gone through the five once more**.
 *
 * ⚠ Both halves, and the second is the one that gets dropped. `agent-runtime.ts` says it
 * twice -- on `ModelShape` and on `CompositeMember` -- because "every member is a tested,
 * enabled model" reads like a complete argument and is not one. `whisper ＋ sonnet` is a
 * pipeline: the handoff between the two, the combined context budget and the behaviour of
 * the chain under a tool call are properties of neither member. A gate that accepted the
 * conjunction of the members would never once have tested the thing that actually runs.
 *
 * ⚠ An EMPTY member list is NOT a pass. A `shape: composite` row with no members is a
 * misconfiguration (0019's trigger admits the state; `effectiveKind` reads it as
 * closed-unknown), and treating "no members" as "all members passed" is the same vacuous
 * conjunction the `requiredItems` guard above refuses.
 */
export function compositeAdmissionGate(
  selfRecords: readonly StoredAdmissionTest[],
  members: readonly MemberAdmission[],
  requiredItems: readonly AdmissionTestItem[] = ADMISSION_TEST_ITEMS,
): CompositeAdmissionResult {
  const self = admissionGate(selfRecords, requiredItems);
  if (!self.ok && self.code === ADMISSION_ITEMS_UNDECLARED) return self;

  const blockedMembers: { modelId: string; blocked: readonly ItemBlock[] }[] = [];
  for (const member of members) {
    const gate = admissionGate(member.records, requiredItems);
    if (!gate.ok && gate.code === ADMISSION_ITEMS_UNDECLARED) return gate;
    if (!gate.ok) blockedMembers.push({ modelId: member.modelId, blocked: gate.blocked });
  }

  if (members.length === 0) return { ok: false, code: COMPOSITE_HAS_NO_MEMBERS };
  if (self.ok && blockedMembers.length === 0) return { ok: true };
  return {
    ok: false,
    code: ADMISSION_TESTS_INCOMPLETE,
    blocked: self.ok ? [] : self.blocked,
    blockedMembers,
  };
}
