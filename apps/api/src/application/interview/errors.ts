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
