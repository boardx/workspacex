/**
 * `recordAdmissionTest` (F49 / uc-20-1 R3 步骤 5).
 *
 * Appends ONE human judgement of ONE of the five items. It never updates anything, and the
 * absence of an update path here is not the guarantee -- migration 0031's triggers are (see
 * `ports.ts`). What this file is responsible for is the two things a database cannot check.
 *
 * ## 1. The verdict is the JUDGE's, and the judge is a person
 *
 * D-07: phase-1 的五项判读是人工的。`judgedBy` is taken from the authenticated principal,
 * NOT from the request body -- a caller that can name its own judge can record 「张三 判了
 * 通过」 without 张三. The contract's `recordAdmissionTest.in` has no `judgedBy` field for
 * exactly this reason, and this signature keeps it that way.
 *
 * ## 2. Recording a verdict does not change `status`
 *
 * Not even when the fifth `通过` lands. `enableModel` is a separate, deliberate act by an
 * administrator (uc-20-2 R3 步骤 1), and auto-enabling on the fifth pass would mean the
 * model went live at the moment someone finished paperwork. The gate reads the log; it is
 * not pushed by it.
 *
 * ⚠ NOT implemented here, and reported rather than silently skipped: uc-20-1 E3 -- 改判为
 * 「不通过」时**自动走与停用同一套级联**并留痕. That cascade is `disableModel`'s
 * (`listModelReferences` -> `disableModel`, 「无清单不得停用」), which belongs to F50/F51 and
 * does not exist yet. Recording a downgrade for an already-enabled model therefore leaves
 * `status` as it was, and I-1 becomes momentarily untrue of that row. `admissionGate` is
 * what any reader should consult; `enabledStatusHolds` below exists so the discrepancy is
 * detectable rather than invisible while the cascade is missing.
 */
import {
  admissionGate,
  type AdmissionTestItem,
  type AdmissionVerdict,
  type StoredAdmissionTest,
} from "../../domain/model/admission";
import type { AdmissionTestRepository } from "./ports";

export interface RecordAdmissionTestDeps {
  readonly repository: AdmissionTestRepository;
}

export async function recordAdmissionTest(
  orgId: string,
  input: {
    readonly modelId: string;
    readonly item: AdmissionTestItem;
    readonly verdict: AdmissionVerdict;
    readonly evidence: string;
  },
  /** The authenticated administrator. Never read from the request body -- see the header. */
  judgedBy: string,
  deps: RecordAdmissionTestDeps,
): Promise<StoredAdmissionTest> {
  return deps.repository.append({ orgId, ...input, judgedBy });
}

/**
 * Does the stored `status` still agree with the log (I-1)?
 *
 * A read-only reconciliation, exported for the invariant sweep rather than called on the
 * write path. It answers "is this row's 已启用 still justified by its latest verdicts", and
 * it is the only thing standing between the missing E3 cascade and a silently stale status.
 */
export function enabledStatusHolds(
  status: string,
  records: readonly StoredAdmissionTest[],
): boolean {
  return status !== "已启用" || admissionGate(records).ok;
}
