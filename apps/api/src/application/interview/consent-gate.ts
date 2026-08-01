/**
 * F88 —— 开始访谈的硬门禁（uc-6-3 R3 步骤7 / AC2，与 `startSession`〔F84〕共用入口）。
 *
 * ## 复用了什么，新增了什么
 *
 * - `deriveConsentStatus`（`domain/interview/subject.ts`）是同意状态**唯一**的派生实现
 *   （I-19/I-20）——本文件不再另写一遍「有没有提交」的判断，一律调它。
 * - `interview_subjects.mode` 是「必需受访者＝主访对象」这条口径已经存在的落点：
 *   notes 原文「必需受访者=主访对象（可多选），观察/陪同不进门禁」——`mode` 恰好
 *   区分「观察」(`observation`) 与「访谈/多人访谈」(`interview`/`group_interview`)，
 *   门禁因此按 `mode !== "observation"` 划必需集合，不新增第二个"required"标记列，
 *   避免又一次「同一事实两处声明」。
 * - 新增的只有 `ConsentGateSubjectReader` 这一个**系统级**读端口：它读的是「本场名单
 *   里每个对象的最新同意位」，供门禁自己用，**不经 `permission-filter`/`Guarded`**。
 *   这是刻意的：门禁必须看到真实提交状态,不能被某个 viewer 的可见性范围过滤——
 *   否则会出现「因为这个 viewer 看不到某个受访者,门禁就对他松开了」这种荒谬的权限
 *   依赖。与 `consent-token-ports.ts` 的 `ConsentRenderParamsProvider`、
 *   `subject-ports.ts` 的 `ConsentSubmissionStore`（本身也不做可见性判断,由调用方
 *   决定何时 `guard()`/`disclose()`）是同一类系统级端口。
 *
 * ## 门禁口径
 *
 * - **必需受访者**＝本场名单里 `mode !== "observation"` 的对象。任何一人的同意状态是
 *   `pending_consent`（尚无提交）⇒ 阻断开始（`CONSENT_REQUIRED`）。
 * - **非必需但同样待签**（`mode === "observation"`）⇒ 不阻断,计入
 *   `excludedSubjectIds`——契约原文「未授权但仍在场者——他们不被录音/转写,但访谈照常」
 *   （E5：不因一人未签而阻断全场）。
 * - 名单为空 ⇒ 没有必需受访者需要等待,门禁不阻断（真空成立）。这是本 feature 的
 *   一个已知边界情形，如实记录：若上游忘记把主访对象排进名单，这里不会替它报错。
 */
import type { OrgId } from "../../domain/org-id";
import { deriveConsentStatus, type ConsentBits, type SubjectMode } from "../../domain/interview/subject";
import type { ConsentGate as RecordingConsentGate } from "../recording/ports";

/** 门禁只需要的三样：是谁、是不是必需（由 `mode` 决定）、最新同意位是什么。 */
export interface ConsentGateSubjectRow {
  readonly subjectId: string;
  readonly mode: SubjectMode;
  /** `null` = 尚无任何提交（≈「待签」）。 */
  readonly bits: ConsentBits | null;
}

/**
 * 系统级读端口——见文件头「为什么不经 `Guarded`」。
 */
export interface ConsentGateSubjectReader {
  /** 本场名单里全部对象及各自最新同意位（一次查询,门禁不逐个调 `ConsentSubmissionStore`）。 */
  rosterWithConsent(orgId: OrgId, interviewSessionId: string): Promise<readonly ConsentGateSubjectRow[]>;
}

export interface ConsentGateResult {
  /** `true` ⇒ `startSession` / 录制转写入口必须拒绝。 */
  readonly blocked: boolean;
  /** 阻断门禁的必需受访者（供错误信息/审计使用）。 */
  readonly pendingRequiredSubjectIds: readonly string[];
  /** 非必需但同样待签——不阻断,标「授权未完成,不会被录音或转写」（E5）。 */
  readonly excludedSubjectIds: readonly string[];
}

/** 纯函数——门禁判定本身不接触任何存储,方便独立测试(与 `deriveConsentStatus` 同一原则)。 */
export function evaluateConsentGate(rows: readonly ConsentGateSubjectRow[]): ConsentGateResult {
  const pendingRequiredSubjectIds: string[] = [];
  const excludedSubjectIds: string[] = [];
  for (const row of rows) {
    if (deriveConsentStatus(row.bits) !== "pending_consent") continue;
    if (row.mode === "observation") excludedSubjectIds.push(row.subjectId);
    else pendingRequiredSubjectIds.push(row.subjectId);
  }
  return {
    blocked: pendingRequiredSubjectIds.length > 0,
    pendingRequiredSubjectIds,
    excludedSubjectIds,
  };
}

export interface ConsentGateDeps {
  readonly reader: ConsentGateSubjectReader;
}

/** 取本场名单 + 判门禁,一步到位——`startSession` 与录制入口的 `ConsentGate` 适配器都调这一个。 */
export async function checkConsentGate(
  deps: ConsentGateDeps,
  orgId: OrgId,
  interviewSessionId: string,
): Promise<ConsentGateResult> {
  const rows = await deps.reader.rosterWithConsent(orgId, interviewSessionId);
  return evaluateConsentGate(rows);
}

/**
 * 适配到 F69 录制入口的 `ConsentGate`（`application/recording/ports.ts`）。
 *
 * ⚠ 这是「仅前端禁用而后端放行不算实现」这条纪律的第二次落地：`startSession`
 * 挡的是「进现场」这个业务动作,但 `startRecording`/`ingestSegment`（F69）是**另一个**
 * 可以被直接调用的入口——没有这个适配器,绕过 `startSession` 直接调录制接口就能
 * 拿到片段。两处共用同一份判定（`checkConsentGate`）,不是各自维护一份「是否已授权」
 * 的逻辑。
 *
 * `orgId` 在构造时固定——`ConsentGate.blocksStart(sourceRefId)` 的签名（F69 既有契约,
 * 三种载体共用,不为本 feature 改动）不带 orgId,所以由调用方（拿到请求上下文的那一层）
 * 在构造这个门禁实例时把 orgId 闭包进去,而不是放宽 F69 的公共接口去牵连与本 feature
 * 无关的 workshop/thread 两条载体。
 */
export function createRecordingConsentGate(deps: ConsentGateDeps, orgId: OrgId): RecordingConsentGate {
  return {
    async blocksStart(sourceRefId: string): Promise<boolean> {
      const result = await checkConsentGate(deps, orgId, sourceRefId);
      return result.blocked;
    },
  };
}
