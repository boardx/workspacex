/**
 * `enableModel` (F49 / uc-20-2 R3 步骤 1, invariant I-1).
 *
 * The gate: 「五项全部『通过』」 for the record itself, and for a composite, additionally for
 * every member on its own.
 *
 * ## The refusal is a WRITE, not just a return value
 *
 * F49's `user_visible_behavior` says 「直接调接口置为已启用被拒绝**并记审计**」. Calling the
 * endpoint straight past the console is the whole threat this gate exists for -- the UI
 * disables its own button, so the only caller that ever reaches the refusal branch is one
 * that went around the UI. A refusal that returns 400 and writes nothing is
 * indistinguishable, afterwards, from a request nobody made. So the audit write happens
 * BEFORE the result is returned, and its failure propagates: an unrecorded refusal is not a
 * successful refusal.
 *
 * ## Why the audit entry carries the blocked items
 *
 * `usecases.md`: `ADMISSION_TESTS_INCOMPLETE` 「必须指出卡在哪一项」. The same detail goes to
 * the caller and into the audit entry, from the same value -- not formatted twice.
 */
import {
  ADMISSION_ITEMS_UNDECLARED,
  ADMISSION_TESTS_INCOMPLETE,
  admissionGate,
  compositeAdmissionGate,
  COMPOSITE_HAS_NO_MEMBERS,
  type CompositeAdmissionResult,
  type ItemBlock,
  type MemberAdmission,
} from "../../domain/model/admission";
import type {
  AdmissionAuditSink,
  AdmissionTestRepository,
  ModelShapeReader,
  ModelStatusWriter,
} from "./ports";

/**
 * ⚠ **No contract code exists for this**, and one is NOT invented here.
 *
 * `enableModel.err` is `NOT_ORG_ADMIN | ADMISSION_TESTS_INCOMPLETE | COMPOSITE_MEMBER_DISABLED
 * | VERSION_CHANGED`; the bundle has `AGENT_NOT_FOUND` but nothing for a model. The state is
 * nonetheless reachable (a stale id, a model removed between two calls) and must not be
 * treated as "gate passed". So it is a LOCAL result variant, reported to the caller of this
 * function and never mapped onto one of the four -- mapping it to
 * `ADMISSION_TESTS_INCOMPLETE` would tell an admin to go re-run tests on a model that does
 * not exist.
 *
 * This is the same shape as `KNOWN_CONTRACT_GAPS.AR7` ("no error code exists for it"), and
 * belongs in that registry. It is not added there by this feature: the bundle is signed off,
 * `contract-design.md` §五 says an agent does not edit a signed contract, and the entry is
 * a sign-off-holder's call. Recorded on the F49 issue instead.
 */
export const MODEL_NOT_FOUND = "MODEL_NOT_FOUND" as const;

export type EnableModelResult =
  | { readonly ok: true; readonly modelId: string; readonly status: "已启用" }
  | {
      readonly ok: false;
      /**
       * ⚠ Every GATE refusal reports `ADMISSION_TESTS_INCOMPLETE` -- `enableModel.err` is a
       * fixed four-member list and an agent may not widen a signed contract
       * (`contract-design.md` §五). `domainCode` keeps the finer distinction the domain
       * draws, for the audit entry and for the tests. `MODEL_NOT_FOUND` is the one value
       * here that has no contract code at all; see its declaration.
       */
      readonly code: typeof ADMISSION_TESTS_INCOMPLETE | typeof MODEL_NOT_FOUND;
      readonly domainCode:
        | typeof ADMISSION_TESTS_INCOMPLETE
        | typeof COMPOSITE_HAS_NO_MEMBERS
        | typeof ADMISSION_ITEMS_UNDECLARED
        | typeof MODEL_NOT_FOUND;
      readonly blocked: readonly ItemBlock[];
      readonly blockedMembers: readonly {
        readonly modelId: string;
        readonly blocked: readonly ItemBlock[];
      }[];
    };

export interface EnableModelDeps {
  readonly admissions: AdmissionTestRepository;
  readonly models: ModelShapeReader;
  readonly status: ModelStatusWriter;
  readonly audit: AdmissionAuditSink;
}

export async function enableModel(
  orgId: string,
  modelId: string,
  actorId: string,
  deps: EnableModelDeps,
): Promise<EnableModelResult> {
  const model = await deps.models.read(orgId, modelId);
  if (model === null) {
    const refusal = {
      ok: false as const,
      code: MODEL_NOT_FOUND,
      domainCode: MODEL_NOT_FOUND,
      blocked: [],
      blockedMembers: [],
    };
    await deps.audit.enableRejected({ orgId, modelId, actorId, code: MODEL_NOT_FOUND, detail: {} });
    return refusal;
  }

  const own = await deps.admissions.listForModel(orgId, modelId);

  // ⚠ `single` and `composite` take DIFFERENT gates, and the composite one is not the
  // single one applied to each member. `compositeAdmissionGate` requires the composite's
  // OWN five as well -- the half that gets dropped, because "every member is tested" reads
  // like a complete argument. See its doc comment.
  let gate: CompositeAdmissionResult;
  if (model.shape === "composite") {
    const members: MemberAdmission[] = [];
    for (const memberId of model.memberIds) {
      members.push({ modelId: memberId, records: await deps.admissions.listForModel(orgId, memberId) });
    }
    gate = compositeAdmissionGate(own, members);
  } else {
    // Widened by hand rather than cast: a `single` refusal has no `blockedMembers`, and an
    // `as` here would leave the field `undefined` on a result whose type promises an array.
    const single = admissionGate(own);
    gate = single.ok
      ? single
      : single.code === ADMISSION_TESTS_INCOMPLETE
        ? { ok: false, code: ADMISSION_TESTS_INCOMPLETE, blocked: single.blocked, blockedMembers: [] }
        : single;
  }

  if (gate.ok) {
    await deps.status.setStatus(orgId, modelId, "已启用");
    return { ok: true, modelId, status: "已启用" };
  }

  const blocked = gate.code === ADMISSION_TESTS_INCOMPLETE ? gate.blocked : [];
  const blockedMembers = gate.code === ADMISSION_TESTS_INCOMPLETE ? gate.blockedMembers : [];
  const detail = { domainCode: gate.code, blocked, blockedMembers };
  // Before the return, and not awaited-and-ignored: see the header.
  await deps.audit.enableRejected({
    orgId,
    modelId,
    actorId,
    code: ADMISSION_TESTS_INCOMPLETE,
    detail,
  });
  return {
    ok: false,
    code: ADMISSION_TESTS_INCOMPLETE,
    domainCode: gate.code,
    blocked,
    blockedMembers,
  };
}
