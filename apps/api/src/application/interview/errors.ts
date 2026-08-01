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

/* ─────────────────────────── F83：反向抽取草案（uc-6-1 A3） ─────────────────────────── */

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
