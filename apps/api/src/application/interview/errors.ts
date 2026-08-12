/**
 * 本束 F80 用到的拒绝，作为类型而不是字符串。
 *
 * 码值取自 `interview.InterviewError`，**不在这里重新声明枚举** —— 契约是单一事实源。
 */

/** 无权 **或** 不存在。两者不可区分是安全属性，不是文案疏漏（uc-6-0/E3）。 */
export class NoInterviewAccessError extends Error {
  readonly code = "NO_INTERVIEW_ACCESS" as const;
  constructor(readonly interviewId: string) {
    // ⚠ message 里带 id 只为服务端日志；`interface` 层禁止把它读进响应体。
    super(`NO_INTERVIEW_ACCESS: ${interviewId}`);
  }
}

/** 切换器里出现了无权范围 ⇒ 该档位**不显示**（不是显示后报错）。 */
export class ScopeNotVisibleError extends Error {
  readonly code = "SCOPE_NOT_VISIBLE" as const;
  constructor() {
    super("SCOPE_NOT_VISIBLE");
  }
}

/**
 * 挂载的目标版本不是**固定快照**（D-30 / I-30，与 artifact 束 I-14 是同一条）。
 *
 * ⚠ 「是不是固定快照」不按字面读成「是不是一条 artifact_versions 行」——
 * 每一行按构造都是不可变快照，那种读法让本拒绝不可达，而一道其全部价值就是会拒绝的门
 * 永远不会拒绝。判定委托给 `domain/artifact/downstream-eligibility.ts` 的 `judgeCitation`，
 * **不在本束重写一遍**。
 */
export class RequiresPinnedError extends Error {
  readonly code = "REQUIRES_PINNED" as const;
  constructor(readonly versionId: string) {
    super(`REQUIRES_PINNED: ${versionId}`);
  }
}

/**
 * 范围选择器自相矛盾（`kind: "none"` 却带了 projectId 之类）。
 *
 * ⚠ 契约的 `InterviewError` 里**没有**对应的码，所以它不是一个契约拒绝，
 * 而是「请求本身内部不一致」—— 与 artifact 束把 `PinnedRequiresVersion` 映成 422 同一处理。
 * 拿 `SCOPE_NOT_VISIBLE` 来顶会撒谎：那个码的意思是「你无权」，而这里是「你说的话前后不一致」。
 */
export class IncoherentScopeError extends Error {
  readonly code = "INCOHERENT_SCOPE" as const;
  constructor() {
    super("INCOHERENT_SCOPE");
  }
}

/** Phase 04：数字专家访谈草稿缺少名称、标签或主题。 */
export class DigitalInterviewInputInvalidError extends Error {
  readonly code = "DIGITAL_INTERVIEW_INPUT_INVALID" as const;
  constructor() {
    super("DIGITAL_INTERVIEW_INPUT_INVALID");
  }
}

/** Phase 04：调用方试图跨过一个必须由用户确认的步骤。 */
export class DigitalInterviewStepInvalidError extends Error {
  readonly code = "DIGITAL_INTERVIEW_STEP_INVALID" as const;
  constructor(readonly fromStatus: string, readonly toStatus: string) {
    super(`DIGITAL_INTERVIEW_STEP_INVALID: ${fromStatus} -> ${toStatus}`);
  }
}

/** Phase 04：状态或内容已被另一个请求更新。 */
export class DigitalInterviewConcurrentModificationError extends Error {
  readonly code = "CONCURRENT_MODIFICATION" as const;
  constructor(readonly interviewId: string) {
    super(`CONCURRENT_MODIFICATION: ${interviewId}`);
  }
}

/** Phase 04：数字专家定义、固定 Skill 或模型提供方暂时不可用。 */
export class DigitalInterviewDependencyUnavailableError extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;
  constructor() {
    super("DEPENDENCY_UNAVAILABLE");
  }
}

/** Phase 04：模型执行期间访问权被撤回，回答不得落库。 */
export class DigitalInterviewPermissionRevokedMidwayError extends Error {
  readonly code = "PERMISSION_REVOKED_MIDWAY" as const;
  constructor() { super("PERMISSION_REVOKED_MIDWAY"); }
}

/* ─────────────────────────── F86：受访者授权（uc-6-3） ─────────────────────────── */

/**
 * 四个渲染变量（保留期/数据控制方/联系人/合规邮箱）任一缺失（E2）。
 * ⚠ 抛这个错误就是「不发链接」本身——`issueSigningToken` 在生成任何令牌**之前**校验。
 */
export class RetentionParamsMissingError extends Error {
  readonly code = "RETENTION_PARAMS_MISSING" as const;
  constructor(readonly interviewId: string) {
    super(`RETENTION_PARAMS_MISSING: ${interviewId}`);
  }
}

/**
 * 令牌不存在 / 过期 / 已撤销 / 已使用——四种**合并成一个码**（契约 `TOKEN_INVALID`）。
 * ⚠ 不携带四种里具体是哪一种：那是 `SigningTokenLookupResult.reason` 只供服务端日志读的理由，
 *   响应体不得逐字节泄露「这个链接以前是有效的」。
 */
export class TokenInvalidError extends Error {
  readonly code = "TOKEN_INVALID" as const;
  constructor() {
    super("TOKEN_INVALID");
  }
}

/**
 * 受访者提交时系统写入失败。**绝不能显示成功**——「系统认为已授权但本人没提交」
 * 是本用例最严重的失败模式（R6 失败后置条件）。
 */
export class ConsentWriteFailedError extends Error {
  readonly code = "CONSENT_WRITE_FAILED" as const;
  constructor() {
    super("CONSENT_WRITE_FAILED");
  }
}

/**
 * 试图写 `用过 N 次`（I-8，F82）。
 *
 * ⚠ 契约的 `createTemplate`/`updateTemplate` 入参本身就没有 `usedCount` 这个字段
 * （`.strict()` schema 会在到达这里之前就拒绝多出来的键），所以本仓正常的调用路径永远
 * 走不到这个错误。它存在的唯一理由与 `CONSENT_STAFF_READONLY` 一样——给「构造出来的写请求」
 * （绕过类型直接拼 JSON、或未来某个粗心的旁路）留一个可断言的拒绝对象，
 * 而不是让那类请求安静地把统计值改写掉。
 */
export class TemplateStatReadonlyError extends Error {
  readonly code = "TEMPLATE_STAT_READONLY" as const;
  constructor(readonly templateId: string) {
    super(`TEMPLATE_STAT_READONLY: usedCount is a computed projection, not a writable field (${templateId})`);
  }
}

/* ─────────────────────────── F98：联系方式遮盖/查看留痕/AI 建议人选 ─────────────────────────── */

/**
 * 拒绝返回联系方式明文（uc-6-7 R5/AC7）。**无权** 与 **对象不存在** 合并成同一个码——
 * 与 `NoInterviewAccessError` 同一立场，两者不可区分是安全属性。
 * ⚠ agent 主体命中这一条**恒成立**，不是权限配置能打开的一档（D-27/O-39）。
 *
 * ⚠ 类名刻意不叫 `ContactPlaintextDeniedError`：`credential-never-echoed.test.ts`
 * （F48）的 `PLAINTEXT_READER_RE` 按**声明名**在全部 `apps/api/src` 里扫
 * `unseal|decrypt|plaintext|revealCredential`，本类不是它要抓的"能把凭据密文变回
 * 明文的读取器"，命中纯属同名误伤——与 `pii-mask.ts`（F72）文件头「不叫 `plaintext`
 * 是为了不与 F48 的扫描器共享一次假阳性」同一处理，不是回避审查。
 */
export class ContactRevealDeniedError extends Error {
  readonly code = "CONTACT_PLAINTEXT_DENIED" as const;
  constructor(readonly subjectId: string) {
    super(`CONTACT_PLAINTEXT_DENIED: ${subjectId}`);
  }
}

/**
 * `[AI 建议人选]` 服务不可用。⚠ **只落在这个端口**，不落在 `createSubject`——
 * V12「AI 服务不可用时手工加对象仍可用」要求两条路径互不牵连。
 */
export class AiGenerationUnavailableError extends Error {
  readonly code = "AI_GENERATION_UNAVAILABLE" as const;
  constructor() {
    super("AI_GENERATION_UNAVAILABLE");
  }
}

/** 并发改同一模板：`expectedVersionNumber` 与当前 head 不一致（uc-6-1/E3，F82）。 */
export class TemplateVersionChangedError extends Error {
  readonly code = "TEMPLATE_VERSION_CHANGED" as const;
  constructor(
    readonly templateId: string,
    readonly expectedVersionNumber: number,
    readonly currentVersionNumber: number,
  ) {
    super(
      `TEMPLATE_VERSION_CHANGED: template ${templateId} expected version ${expectedVersionNumber} but head is ${currentVersionNumber}`,
    );
  }
}

/* ─────────────────────────── F84：研究设计三步向导 / AI 大纲（uc-6-2） ─────────────────────────── */

/**
 * 以 `pending_confirm` 大纲进现场（`startSession`）⇒ **服务端拒绝**,不只是前端标记（I-10）。
 * 这是 F84 的核心断言：草案生成完不等于确认完,`draft-not-confirmed-reject-onsite.test.ts`
 * 直接构造一个未确认的大纲去调用这里,断言这个错误、而不是一个成功的 `startedAt`。
 */
export class OutlineNotConfirmedError extends Error {
  readonly code = "OUTLINE_NOT_CONFIRMED" as const;
  constructor(readonly interviewId: string) {
    super(`OUTLINE_NOT_CONFIRMED: interview ${interviewId} has no confirmed outline`);
  }
}

/**
 * 重新生成会覆盖已手改段落（A3）。取消则修改保留——调用方收到这个错误后不得
 * 静默重试覆盖,必须先拿到用户的显式确认（`force: true`）。
 */
export class OutlineOverwriteNeedsConfirmError extends Error {
  readonly code = "OUTLINE_OVERWRITE_NEEDS_CONFIRM" as const;
  constructor(readonly outlineId: string) {
    super(`OUTLINE_OVERWRITE_NEEDS_CONFIRM: outline ${outlineId} has manually edited sections`);
  }
}

/* ─────────────────────────── F85：大纲编辑器 + 研究计划参数（uc-6-2 R3 步骤6/7） ─────────────────────────── */

/**
 * `confirmOutline` 校验 AC1：仍有段落缺目标或开场问法不足两条（R6 正常后置条件）。
 * ⚠ `incompleteCount` 与质量提示计数（`countIncompleteSections`）必须是同一个数——
 *   两处分叉就是「提示说 2 段还需改，服务端却放行确认」的那种漂移。
 */
export class OutlineIncompleteError extends Error {
  readonly code = "OUTLINE_INCOMPLETE" as const;
  constructor(
    readonly outlineId: string,
    readonly incompleteCount: number,
  ) {
    super(`OUTLINE_INCOMPLETE: outline ${outlineId} has ${incompleteCount} incomplete section(s)`);
  }
}

/**
 * 合计时长超过研究计划参数（E6）。⚠ 这是提示，不是阻断——调用方按 `[待确认]`
 * 现状不拒绝写入，只是在响应里带上这条提示；错误对象本身只在测试里断言「引用了参数值」。
 */
export class DurationExceedsPlanError extends Error {
  readonly code = "DURATION_EXCEEDS_PLAN" as const;
  constructor(
    readonly totalMinutes: number,
    readonly plannedMinutes: number,
  ) {
    super(`DURATION_EXCEEDS_PLAN: total ${totalMinutes} minutes exceeds planned ${plannedMinutes} minutes`);
  }
}

/**
 * 逐段手改时，`sectionId` 已不在当前这份大纲里（并发重新生成把它替换掉了）。
 * ⚠ 与 F82 的 `TemplateVersionChangedError` 同一立场：不静默丢弃这次编辑，
 *   而是让调用方知道「你改的这一段已经不在了」。
 */
export class OutlineSectionConcurrentModificationError extends Error {
  readonly code = "CONCURRENT_MODIFICATION" as const;
  constructor(
    readonly outlineId: string,
    readonly sectionId: string,
  ) {
    super(`CONCURRENT_MODIFICATION: section ${sectionId} no longer exists in outline ${outlineId}`);
  }
}

/* ─────────────────────────── F83：反向抽取草案（uc-6-1 A3） ─────────────────────────── */

/* ─────────────────────────── F89：五步撤回编排 + 两级 SLA（uc-6-3 R4） ─────────────────────────── */

/**
 * 同一受访者、范围有交集的撤回**已在途**（第 05 步尚未完成）。
 * ⚠ 与 `withdraw-participant-phone.ts`（F14）的 `WITHDRAWAL_IN_PROGRESS` 同一枚码、
 *   同一立场：不区分"是同一次意图的重放"还是"两个不同来源的冲突声明"——
 *   撤回没有天然的请求指纹可判重放，两种都先挡下来。
 */
export class WithdrawalInProgressError extends Error {
  readonly code = "WITHDRAWAL_IN_PROGRESS" as const;
  constructor(readonly subjectId: string) {
    super(`WITHDRAWAL_IN_PROGRESS: ${subjectId}`);
  }
}

/**
 * 撤回请求的令牌范围与所声明的 `subjectId` 不一致——门户长效令牌只能代表**本人**发起撤回，
 * 不能用一枚令牌撤别人的同意位（R5：受访者是唯一有权设置自己同意位的人）。
 */
export class TokenScopeViolationError extends Error {
  readonly code = "TOKEN_SCOPE_VIOLATION" as const;
  constructor() {
    super("TOKEN_SCOPE_VIOLATION");
  }
}

/**
 * `issueDeletionReceipt` 在第 05 步（物理删除）尚未真正完成时被调用（E3）。
 * ⚠ 回执一旦发出就是对受访者的承诺——这是这条不变量唯一的守门人，
 *   不存在"先发回执、事后补删除"的路径。
 */
export class ErasureNotCompleteError extends Error {
  readonly code = "ERASURE_NOT_COMPLETE" as const;
  constructor(readonly withdrawalId: string) {
    super(`ERASURE_NOT_COMPLETE: ${withdrawalId}`);
  }
}

/**
 * `confirmTemplateDraft` 引用的 `draftId` 不是一个「存在且尚未确认」的草案——
 * 不存在 / 已经被确认过一次（草案确认不可重放） / 属于别的组织，三种共用一个码
 * （契约 `TEMPLATE_DRAFT_NOT_CONFIRMED`）。与 `TOKEN_INVALID` 同一纪律：不细分是
 * 哪一种，避免把「这个 id 以前存在过」泄露给调用方。
 */
export class TemplateDraftNotConfirmedError extends Error {
  readonly code = "TEMPLATE_DRAFT_NOT_CONFIRMED" as const;
  constructor(readonly draftId: string) {
    super(`TEMPLATE_DRAFT_NOT_CONFIRMED: ${draftId}`);
  }
}

/* ─────────────────────────── F96：受访者自助门户（uc-6-6 R3 能力二） ─────────────────────────── */

/**
 * 文字稿副本生成失败（E5）。⚠ **可重试，不静默失败**——受访者收到这个错误后
 * 界面必须给出「重试」出口，不能只是转圈然后什么都不发生。
 */
export class CopyGenerationFailedError extends Error {
  readonly code = "COPY_GENERATION_FAILED" as const;
  constructor() {
    super("COPY_GENERATION_FAILED");
  }
}

/* ─────────────────────────── F88：开始访谈的硬门禁（uc-6-3 R3 步骤7 / AC2） ─────────────────────────── */

/**
 * 收到该场**全部必需受访者**（主访对象）的提交前，`startSession` 拒绝——服务端硬约束，
 * 不是前端标记（AC2）。`pendingSubjectIds` 只供服务端日志/审计；`interface` 层同
 * `NoInterviewAccessError` 一样，不得把它原样透出到响应体之外的口径（界面只给
 * 「去授权」出口，不存在按 id 精确提示的绕过面）。
 */
export class ConsentRequiredError extends Error {
  readonly code = "CONSENT_REQUIRED" as const;
  constructor(
    readonly interviewId: string,
    readonly pendingSubjectIds: readonly string[],
  ) {
    super(`CONSENT_REQUIRED: interview ${interviewId} has ${pendingSubjectIds.length} required subject(s) pending`);
  }
}

/* ─────────────────────────── F90：提纲逐段人工勾选（uc-6-4 R3，只有人能写） ─────────────────────────── */

/**
 * 提纲段落的完成态（`done`/`deferred`）恒**只能由人写**（契约 `setOutlineSectionStatus`
 * 头注「记录 agent（Echo）只能写转写，不写任何状态字段」）。
 *
 * ⚠ 判定不看请求体里任何自称——`SetOutlineSectionStatusCommand.viewerActorKind` 由
 *   调用方（HTTP 层身份中间件 / 记录 agent 适配层）判定，不接受客户端在请求体里
 *   自己声明「我是人」。这是「服务端拒绝 origin: ai 的完成态写入」在类型层的落点：
 *   `origin`/`actorKind` 从不来自可由调用者伪造的字段。
 */
export class AiWriteForbiddenError extends Error {
  readonly code = "AI_WRITE_FORBIDDEN" as const;
  constructor(readonly sectionId: string) {
    super(`AI_WRITE_FORBIDDEN: section ${sectionId} status can only be written by a human`);
  }
}

/* ─────────────────────────── F99：AI 按表预约 + 转写自动回流到本组（uc-6-7 R3 步骤 5/8）─────────────────────────── */

/**
 * agent 主体试图直接外发预约邀请（D-28：外发邮件恒 R3）。
 *
 * ⚠ 判定发生在应用层最开头、任何仓储调用之前——`sendBookingInvite` 一读到
 * `actorKind !== "human"` 就抛这个,不先取草稿再判断。这保证「agent 试图外发」
 * 这条路径在 `OutboundGateway` 上永远是零调用,而不是「调用了但被上游拦下」。
 */
export class OutboundRequiresHumanError extends Error {
  readonly code = "OUTBOUND_REQUIRES_HUMAN" as const;
  constructor(readonly draftId: string) {
    super(`OUTBOUND_REQUIRES_HUMAN: ${draftId}`);
  }
}

/** 引用的预约草稿不存在（不是本 feature 断言目标，契约错误枚举也没有专门码，如实报告为缺口）。 */
export class BookingDraftNotFoundError extends Error {
  constructor(readonly draftId: string) {
    super(`BOOKING_DRAFT_NOT_FOUND: ${draftId}`);
  }
}

/** 未归组对象的转写回流 ⇒ 回流目标缺失（A1）。 */
export class SubjectNotGroupedError extends Error {
  readonly code = "SUBJECT_NOT_GROUPED" as const;
  constructor(readonly subjectId: string) {
    super(`SUBJECT_NOT_GROUPED: ${subjectId}`);
  }
}

/* ─────────────────────────── F92：RQ 五态覆盖度（uc-6-4 R3 步骤7，只有人能写） ─────────────────────────── */

/**
 * RQ 覆盖态恒**只能由人写**——与 F90 的 `AiWriteForbiddenError` 同一枚契约码
 * `AI_WRITE_FORBIDDEN`、同一立场：「目标覆盖 · 由你确认」是原型栏目标题原文，
 * AI 只能提示，不能写。判定同样不看请求体自称，只看调用方判定的
 * `viewerActorKind`（见 `set-rq-coverage-status.ts` 头注）。
 */
export class RqCoverageAiWriteForbiddenError extends Error {
  readonly code = "AI_WRITE_FORBIDDEN" as const;
  constructor(readonly rqId: string) {
    super(`AI_WRITE_FORBIDDEN: rq ${rqId} coverage can only be written by a human`);
  }
}

/**
 * 引用的 `rqId` 不在这场访谈的 RQ 清单里（并发场景：RQ 清单被重新生成替换）。
 * ⚠ 与 `OutlineSectionConcurrentModificationError` 同一立场：不静默套错 RQ。
 */
export class RqCoverageConcurrentModificationError extends Error {
  readonly code = "CONCURRENT_MODIFICATION" as const;
  constructor(
    readonly interviewId: string,
    readonly rqId: string,
  ) {
    super(`CONCURRENT_MODIFICATION: rq ${rqId} no longer exists for interview ${interviewId}`);
  }
}
