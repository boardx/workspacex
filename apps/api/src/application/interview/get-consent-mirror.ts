/**
 * `getConsentMirror`（F87 / uc-6-3 R3 第 6 步、R5、R6、契约 `interview.getConsentMirror`）
 * —— 研究员侧**只读**镜像。
 *
 * ## 为什么这个文件里没有任何"改同意位"的路径
 *
 * uc-6-3 R5/R7 的硬约束是「研究员**不可代勾、不可覆盖、不可撤销**受访者的选择——
 * 系统层面不提供这样的接口」（AC4）。本文件因此只读不写：所有数据经
 * `subject-projections.ts` 的 `getInterviewRosterSubjectsWithDecision`（已只读、已按
 * `canReadSubject` 过滤观察者）取得，再叠加提交时间；没有任何参数、任何分支允许改写
 * `interview_consent_submissions`。`CONSENT_STAFF_READONLY`（契约 `KNOWN_CONTRACT_GAPS.C_ITV_7`）
 * 之所以在契约里"不可达"，就是因为这一层压根不提供写口——不是提供了但恒拒绝。
 *
 * ## `grantedOfFour` 的头字段是谁的"4 项里几项"
 *
 * 契约把 `rows`（全部受访者）和 `grantedOfFour: "N/4"`（单一字符串）并列在同一个响应里。
 * 对照 V1/AC1 的现场状态条口径「授权 3/4 · Weber 不参与 AI 分析」——那是**单个受访者**
 * 的授权计数，用于 1:1 访谈的头部状态条。多人访谈时这个头字段该聚合成什么样，
 * uc-6-3 R10 把「授权与准备」子标签内部标为**未探明**，本用例自己没有裁决。
 * ⇒ 本实现取**名单里第一个已提交的受访者**作为头字段来源（1:1 场景下就是唯一受访者，
 * 与 V1 完全对齐）；多人场景下这只是一个不代表全场的近似值，如实标注为待产品确认的缺口，
 * 不在这里替 UC 发明一种聚合算法。
 */
import type { ConsentBits } from "../../domain/interview/subject";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { getInterviewRosterSubjectsWithDecision } from "./subject-projections";
import type { ConsentSubmissionStore, SubjectRepository } from "./subject-ports";

export interface ConsentMirrorDeps {
  readonly subjects: SubjectRepository;
  readonly consent: ConsentSubmissionStore;
  readonly decisions: DecisionIdFactory;
}

export interface ConsentMirrorRow {
  readonly subjectId: string;
  /** `null` = 尚无任何提交（uc-6-7 三态里的「待签」）。 */
  readonly bits: ConsentBits | null;
  readonly submittedAt: string | null;
  readonly consentStatus: string;
}

export interface ConsentMirrorOutput {
  readonly rows: ConsentMirrorRow[];
  /** 形如 `"3/4"`。见文件头「头字段是谁的」。 */
  readonly grantedOfFour: string;
}

function countGranted(bits: ConsentBits): number {
  return [bits.record, bits.transcript, bits.ai_analysis, bits.attribution].filter(Boolean).length;
}

export async function getConsentMirror(
  deps: ConsentMirrorDeps,
  orgId: OrgId,
  viewerUserId: string,
  interviewSessionId: string,
): Promise<ConsentMirrorOutput> {
  const roster = await getInterviewRosterSubjectsWithDecision(
    { subjects: deps.subjects, consent: deps.consent, decisions: deps.decisions },
    orgId,
    viewerUserId,
    interviewSessionId,
  );

  const rows: ConsentMirrorRow[] = [];
  let headline: string | null = null;

  for (const { subject, decision } of roster) {
    // 复用该行对象**已经**算出的同一个 `PermissionDecision` 去解封"提交时间"这个 facet，
    // 而不是另起一次判定——同一条记录、同一个人，可见性只应该被判一次
    // （与 `subject-projections.ts` 对"同意位"facet 的处理同一条纪律）。
    const metaGuarded = await deps.consent.latestSubmissionMeta(orgId, interviewSessionId, subject.subjectId);
    const metaDisclosed = discloseDecided(metaGuarded, decision);
    const meta = isDisclosed(metaDisclosed) ? metaDisclosed.payload : null;

    rows.push({
      subjectId: subject.subjectId,
      bits: meta?.bits ?? null,
      submittedAt: meta?.submittedAt.toISOString() ?? null,
      consentStatus: subject.consentStatus,
    });

    if (headline === null && meta !== null) {
      headline = `${countGranted(meta.bits)}/4`;
    }
  }

  return { rows, grantedOfFour: headline ?? "0/4" };
}
