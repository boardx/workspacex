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
